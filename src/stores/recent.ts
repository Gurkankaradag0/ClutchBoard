import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { deleteArchives } from '@/lib/archive'
import { queryClient } from '@/lib/query-client'

// Recent searches and favorites (localStorage). A player's match archive is kept only while they're
// in this list; removing them (X, clear, or overflow past the limit) deletes it.
export type RecentEntry = {
    name: string
    tag: string
    puuid: string
    region: string
    card: string
    level: number
    tier?: number
    tierName?: string
    favorite: boolean
    at: number
}

const MAX_RECENT = 12
const same = (a: { name: string; tag: string }, b: { name: string; tag: string }) => a.name.toLowerCase() === b.name.toLowerCase() && a.tag.toLowerCase() === b.tag.toLowerCase()

type State = {
    entries: RecentEntry[]
    remember: (e: Omit<RecentEntry, 'favorite' | 'at'>) => void
    patch: (puuid: string, p: Partial<RecentEntry>) => void
    toggleFavorite: (puuid: string) => void
    remove: (puuid: string) => void
    /** Non-favorites */
    clear: () => void
    clearFavorites: () => void
    clearAll: () => void
}

/** Deletes archives of players that are no longer in the list. */
const dropArchives = (before: RecentEntry[], after: RecentEntry[]) => {
    const keep = new Set(after.map((e) => e.puuid))
    void deleteArchives(
        queryClient,
        before.filter((e) => !keep.has(e.puuid)).map((e) => e.puuid)
    )
}

export const useRecent = create<State>()(
    persist(
        (set, get) => ({
            entries: [],
            remember: (e) =>
                set(({ entries }) => {
                    const prev = entries.find((x) => x.puuid === e.puuid || same(x, e))
                    const next = [{ ...prev, ...e, favorite: prev?.favorite ?? false, at: Date.now() }, ...entries.filter((x) => x !== prev)]
                    // Favorites don't count toward the limit.
                    let plain = 0
                    const kept = next.filter((x) => x.favorite || ++plain <= MAX_RECENT)
                    dropArchives(entries, kept)
                    return { entries: kept }
                }),
            patch: (puuid, p) => set(({ entries }) => ({ entries: entries.map((x) => (x.puuid === puuid ? { ...x, ...p } : x)) })),
            toggleFavorite: (puuid) => set(({ entries }) => ({ entries: entries.map((x) => (x.puuid === puuid ? { ...x, favorite: !x.favorite } : x)) })),
            remove: (puuid) => {
                const before = get().entries
                set({ entries: before.filter((x) => x.puuid !== puuid) })
                dropArchives(before, get().entries)
            },
            clear: () => {
                const before = get().entries
                set({ entries: before.filter((x) => x.favorite) })
                dropArchives(before, get().entries)
            },
            clearFavorites: () => {
                const before = get().entries
                set({ entries: before.filter((x) => !x.favorite) })
                dropArchives(before, get().entries)
            },
            clearAll: () => {
                const before = get().entries
                set({ entries: [] })
                dropArchives(before, [])
            }
        }),
        { name: 'clutchboard:recent', version: 1 }
    )
)

/** "Name#TAG" -> { name, tag }, or null. Riot names are 3-16 chars, tags 3-5. */
export const parseRiotId = (raw: string) => {
    const i = raw.lastIndexOf('#')
    if (i < 0) return null
    const name = raw.slice(0, i).trim()
    const tag = raw.slice(i + 1).trim()
    if (name.length < 3 || name.length > 16 || tag.length < 3 || tag.length > 5) return null
    return { name, tag }
}
