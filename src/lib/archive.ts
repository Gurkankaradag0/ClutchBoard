import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import { fetchMatchesLive, PAGE_SIZE, type Match, type Mode } from './api'

// Persistent per-player match archive (see archive.rs). Cached matches show up immediately; newer
// ones are fetched in the background until a known match is reached. "Load more" continues from the
// end of the archive. Henrik pages by offset, which shifts as new matches arrive, so these calls skip
// the disk cache.

type List = { ids: string[]; complete: boolean }
type Stored = { lists: Partial<Record<string, List>>; matches: Map<string, Match> }
export type ArchiveView = { matches: Match[]; complete: boolean }

type Status = { syncing: boolean; found: number; loadingMore: boolean; error: unknown; syncedAt: number; rev: number }
const useStatus = create<{ byKey: Record<string, Status | undefined> }>()(() => ({ byKey: {} }))
const setStatus = (key: string, patch: Partial<Status>) => useStatus.setState((s) => ({ byKey: { ...s.byKey, [key]: { syncing: false, found: 0, loadingMore: false, error: null, syncedAt: 0, rev: -1, ...s.byKey[key], ...patch } } }))

const listKey = (mode: Mode) => mode || 'all'
const statusKey = (puuid: string, mode: Mode) => `${puuid}:${listKey(mode)}`
export const archiveKey = (puuid: string | undefined, mode: Mode) => ['archive', puuid, mode] as const

// Loaded once per player.
const loaded = new Map<string, Promise<Stored>>()
const load = (puuid: string) => {
    let p = loaded.get(puuid)
    if (!p) {
        p = invoke<{ lists: Stored['lists']; matches: Match[] } | null>('archive_load', { puuid }).then((r) => ({ lists: r?.lists ?? {}, matches: new Map((r?.matches ?? []).map((m) => [m.metadata.match_id, m])) }))
        loaded.set(puuid, p)
    }
    return p
}

/** Drops heavy fields the UI never reads (~350 KB -> ~95 KB per match). */
const slim = (m: Match): Match => ({ ...m, kills: m.kills.map(({ player_locations: _drop, ...k }: Match['kills'][number] & { player_locations?: unknown }) => k), rounds: m.rounds.map((r) => ({ ...r, stats: [] })) })

const view = (s: Stored, mode: Mode): ArchiveView => {
    const list = s.lists[listKey(mode)]
    return { matches: (list?.ids ?? []).map((id) => s.matches.get(id)).filter((m): m is Match => !!m), complete: list?.complete ?? false }
}

const persist = (puuid: string, s: Stored, added: Match[]) => invoke('archive_save', { puuid, lists: s.lists, matches: added })

// One sync / load per key, even when several pages mount the hook.
const inflight = new Map<string, Promise<void>>()
const once = (key: string, run: () => Promise<void>) => {
    const running = inflight.get(key)
    if (running) return running
    const p = run().finally(() => inflight.delete(key))
    inflight.set(key, p)
    return p
}

// If no known match shows up within this many matches, the list starts over.
const GAP_LIMIT = 300
const SYNC_EVERY_MS = 2 * 60_000

/** Fetches newer matches until it reaches one that's already archived, showing them as they arrive. */
const sync = (qc: QueryClient, region: string, puuid: string, mode: Mode) => {
    const key = statusKey(puuid, mode)
    return once(`sync:${key}`, async () => {
        setStatus(key, { syncing: true, found: 0, error: null })
        try {
            const s = await load(puuid)
            const list = s.lists[listKey(mode)] ?? { ids: [], complete: false }
            const known = new Set(list.ids)
            const fresh: Match[] = []
            let joined = false
            let complete = list.complete
            for (let start = 0; start < GAP_LIMIT; start += PAGE_SIZE) {
                const page = await fetchMatchesLive(region, puuid, mode, start)
                const at = page.findIndex((m) => known.has(m.metadata.match_id))
                fresh.push(...(at === -1 ? page : page.slice(0, at)))
                if (at !== -1 || !list.ids.length || page.length < PAGE_SIZE) {
                    joined = true
                    // First visit: one page. Fewer than a full page means the end of history.
                    if (!list.ids.length && page.length < PAGE_SIZE) complete = true
                    break
                }
                // Show partial results while catching up.
                setStatus(key, { found: fresh.length })
                qc.setQueryData(archiveKey(puuid, mode), { matches: [...fresh, ...view(s, mode).matches], complete })
            }
            const added = fresh.map(slim).filter((m) => !s.matches.has(m.metadata.match_id))
            for (const m of fresh) s.matches.set(m.metadata.match_id, slim(m))
            s.lists[listKey(mode)] = { ids: [...fresh.map((m) => m.metadata.match_id), ...(joined ? list.ids : [])], complete: joined ? complete : false }
            await persist(puuid, s, added)
            qc.setQueryData(archiveKey(puuid, mode), view(s, mode))
            setStatus(key, { syncing: false, found: fresh.length, syncedAt: Date.now() })
        } catch (error) {
            setStatus(key, { syncing: false, error })
        }
    })
}

/** One more page of older matches. Waits for sync, since the offset is only valid on a gapless list. */
const loadMore = (qc: QueryClient, region: string, puuid: string, mode: Mode) => {
    const key = statusKey(puuid, mode)
    return once(`more:${key}`, async () => {
        await inflight.get(`sync:${key}`)
        setStatus(key, { loadingMore: true, error: null })
        try {
            const s = await load(puuid)
            const list = s.lists[listKey(mode)] ?? { ids: [], complete: false }
            const page = await fetchMatchesLive(region, puuid, mode, list.ids.length)
            const have = new Set(list.ids)
            const older = page.filter((m) => !have.has(m.metadata.match_id))
            const added = older.map(slim).filter((m) => !s.matches.has(m.metadata.match_id))
            for (const m of older) s.matches.set(m.metadata.match_id, slim(m))
            s.lists[listKey(mode)] = { ids: [...list.ids, ...older.map((m) => m.metadata.match_id)], complete: page.length < PAGE_SIZE }
            await persist(puuid, s, added)
            qc.setQueryData(archiveKey(puuid, mode), view(s, mode))
            setStatus(key, { loadingMore: false })
        } catch (error) {
            setStatus(key, { loadingMore: false, error })
        }
    })
}

/** Removes the players' archives and cached responses. */
export const deleteArchives = async (qc: QueryClient, puuids: string[]) => {
    if (!puuids.length) return
    for (const p of puuids) {
        loaded.delete(p)
        qc.removeQueries({ queryKey: ['archive', p] })
    }
    await invoke('forget_players', { puuids })
}

export type ArchiveState = {
    matches: Match[]
    isPending: boolean
    error: unknown
    syncing: boolean
    found: number
    hasMore: boolean
    loadingMore: boolean
    loadMore: () => void
}

/**
 * Match list for a profile. Re-syncs when `rev` changes or 2 minutes after the last sync.
 */
export const useArchive = (region: string | undefined, puuid: string | undefined, mode: Mode, rev: number): ArchiveState => {
    const qc = useQueryClient()
    const key = puuid ? statusKey(puuid, mode) : ''
    const status = useStatus((s) => s.byKey[key])
    const q = useQuery({ queryKey: archiveKey(puuid, mode), queryFn: async () => view(await load(puuid!), mode), enabled: !!puuid, staleTime: Infinity, gcTime: 30 * 60_000 })

    useEffect(() => {
        if (!region || !puuid || !q.isSuccess) return
        const st = useStatus.getState().byKey[statusKey(puuid, mode)]
        if (st && st.rev === rev && Date.now() - st.syncedAt < SYNC_EVERY_MS) return
        setStatus(statusKey(puuid, mode), { rev })
        void sync(qc, region, puuid, mode)
    }, [qc, region, puuid, mode, rev, q.isSuccess])

    const matches = q.data?.matches ?? []
    return {
        matches,
        // Skeleton only while the archive is empty.
        isPending: q.isPending || (!matches.length && !!status?.syncing) || (!matches.length && !status),
        error: status?.error ?? q.error,
        syncing: !!status?.syncing,
        found: status?.found ?? 0,
        hasMore: !(q.data?.complete ?? false),
        loadingMore: !!status?.loadingMore,
        loadMore: () => {
            if (region && puuid) void loadMore(qc, region, puuid, mode)
        }
    }
}
