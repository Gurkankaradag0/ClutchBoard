import type { QueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Match } from '@/lib/api'

// Riot/Henrik can't search by name prefix (account-v1 needs the full Name#TAG), so autocomplete
// uses a local index of everyone seen in opened matches, like tracker.gg does server-side.
export type SeenPlayer = { puuid: string; name: string; tag: string; card: string; tier: number; tierName: string; region: string; seen: number }

// ~150 B per entry, 5000 entries ≈ 750 KB of localStorage. Oldest entries drop first.
const MAX = 5000

type State = { players: Record<string, SeenPlayer>; add: (list: SeenPlayer[]) => void; clear: () => void }

export const useSeen = create<State>()(
    persist(
        (set) => ({
            players: {},
            add: (list) =>
                set(({ players }) => {
                    const next = { ...players }
                    let changed = false
                    for (const p of list) {
                        if (!p.name || !p.tag) continue
                        const prev = next[p.puuid]
                        // Names change; the newest match wins.
                        if (prev && prev.seen >= p.seen) continue
                        next[p.puuid] = p
                        changed = true
                    }
                    if (!changed) return {}
                    const all = Object.values(next)
                    if (all.length <= MAX) return { players: next }
                    return {
                        players: Object.fromEntries(
                            all
                                .sort((a, b) => b.seen - a.seen)
                                .slice(0, MAX)
                                .map((p) => [p.puuid, p])
                        )
                    }
                }),
            clear: () => set({ players: {} })
        }),
        { name: 'clutchboard:seen', version: 1 }
    )
)

const fromMatch = (m: Match): SeenPlayer[] => {
    const seen = Date.parse(m.metadata.started_at) || Date.now()
    return m.players.map((p) => ({ puuid: p.puuid, name: p.name, tag: p.tag, card: p.customization.card, tier: p.tier.id, tierName: p.tier.name, region: m.metadata.region, seen }))
}

/** Indexes players from archive and match queries. Called once at startup. */
export const indexMatchesFrom = (qc: QueryClient) =>
    qc.getQueryCache().subscribe((e) => {
        if (e.type !== 'updated' || e.action.type !== 'success') return
        const [key] = e.query.queryKey
        const data = e.query.state.data
        if (key === 'archive' && data) useSeen.getState().add((data as { matches: Match[] }).matches.flatMap(fromMatch))
        else if (key === 'match' && data) useSeen.getState().add(fromMatch(data as Match))
    })
