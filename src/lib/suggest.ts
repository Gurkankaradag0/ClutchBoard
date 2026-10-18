import type { RecentEntry } from '@/stores/recent'
import type { SeenPlayer } from '@/stores/players'

export type Suggestion = { puuid: string; name: string; tag: string; card: string; tier?: number; tierName?: string; region: string; source: 'favorite' | 'recent' | 'seen' }

const LIMIT = 8

/**
 * "Name" matches every name with that prefix (one row per tag).
 * "Name#ta" matches that exact name with tags starting with "ta".
 * Prefix beats substring; then favorite > recent > seen; then newest.
 */
export const suggest = (raw: string, recent: RecentEntry[], seen: Record<string, SeenPlayer>): Suggestion[] => {
    const q = raw.trim().toLowerCase()
    if (!q) return recent.slice(0, 5).map((e) => ({ ...e, source: e.favorite ? 'favorite' : 'recent' }))

    const hash = q.indexOf('#')
    const qName = hash < 0 ? q : q.slice(0, hash)
    const qTag = hash < 0 ? null : q.slice(hash + 1)

    // 0 = prefix, 1 = contains, -1 = no match
    const rank = (name: string, tag: string) => {
        const n = name.toLowerCase()
        if (qTag !== null) return n === qName && tag.toLowerCase().startsWith(qTag) ? 0 : -1
        if (n.startsWith(qName)) return 0
        return qName.length >= 3 && n.includes(qName) ? 1 : -1
    }

    const pool = new Map<string, Suggestion & { at: number }>()
    for (const e of recent) pool.set(e.puuid, { ...e, source: e.favorite ? 'favorite' : 'recent', at: e.at })
    for (const p of Object.values(seen)) if (!pool.has(p.puuid)) pool.set(p.puuid, { ...p, source: 'seen', at: p.seen })

    const order = { favorite: 0, recent: 1, seen: 2 }
    return [...pool.values()]
        .map((s) => ({ s, r: rank(s.name, s.tag) }))
        .filter((x) => x.r >= 0)
        .sort((a, b) => a.r - b.r || order[a.s.source] - order[b.s.source] || b.s.at - a.s.at)
        .slice(0, LIMIT)
        .map(({ s: { at: _at, ...s } }) => s)
}
