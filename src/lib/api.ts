import { invoke } from '@tauri-apps/api/core'
import type { TFunction } from 'i18next'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

// All Henrik requests go through the Rust `henrik` command (key, rate limit, disk cache).
// TTL in seconds: null = never expires, 0 = no cache.

export type ApiError = { kind: 'noKey' } | { kind: 'notFound'; message: string } | { kind: 'rateLimited'; retryAfter: number } | { kind: 'http'; status: number; message: string } | { kind: 'network'; message: string }

export const isApiError = (e: unknown): e is ApiError => typeof e === 'object' && e !== null && 'kind' in e

type Envelope<T> = { status: number; data: T; results?: { total: number; returned: number; before: number; after: number } }

const henrik = <T>(path: string[], opts: { query?: Record<string, string | number | undefined>; ttl: number | null; fresh?: boolean }) =>
    invoke<Envelope<T>>('henrik', {
        path,
        query: Object.entries(opts.query ?? {})
            .filter(([, v]) => v !== undefined && v !== '')
            .map(([k, v]) => [k, String(v)]),
        ttl: opts.ttl,
        fresh: opts.fresh ?? false
    })

export const PLATFORM = 'pc'
export const PAGE_SIZE = 10

export type Ref = { id: string; name: string }
export type Tier = { id: number; name: string }
export type Season = { id: string; short: string }

export type Account = {
    puuid: string
    region: string
    account_level: number
    name: string
    tag: string
    card: string
    title: string
    platforms: string[]
    updated_at: string
}

export type SeasonalMmr = {
    season: Season
    wins: number
    games: number
    end_tier: Tier
    end_rr: number
    ranking_schema: string
    leaderboard_placement: { rank: number } | null
    act_wins: Tier[]
}

export type Mmr = {
    account: { name: string; tag: string; puuid: string }
    peak: { season: Season; ranking_schema: string; tier: Tier; rr: number } | null
    current: {
        tier: Tier
        rr: number
        last_change: number
        elo: number
        games_needed_for_rating: number
        rank_protection_shields?: number
        leaderboard_placement: { rank: number; updated_at: string } | null
    }
    seasonal: SeasonalMmr[]
}

export type PlayerRef = { puuid: string; name: string; tag: string; team: string }

export type MatchPlayer = {
    puuid: string
    name: string
    tag: string
    team_id: string
    platform: string
    party_id: string
    agent: Ref
    stats: { score: number; kills: number; deaths: number; assists: number; headshots: number; bodyshots: number; legshots: number; damage: { dealt: number; received: number } }
    ability_casts: { grenade: number | null; ability1: number | null; ability2: number | null; ultimate: number | null }
    /** Riot Performance Score (0–500, patch 13.06+). Missing on older matches. */
    performance?: { score: number; breakdown: Record<string, number>; ratings: { grade: string; combat: Record<string, string>; utility: Record<string, string> } } | null
    tier: Tier
    customization: { card: string; title: string; preferred_level_border: string | null }
    account_level: number
    economy: { spent: { overall: number; average: number }; loadout_value: { overall: number; average: number } }
}

export type MatchTeam = { team_id: string; rounds: { won: number; lost: number }; won: boolean; premier_roster: unknown }

export type RoundStat = {
    player: PlayerRef
    stats: { score: number; kills: number; headshots: number; bodyshots: number; legshots: number }
    damage_events: { player: PlayerRef; damage: number; headshots: number; bodyshots: number; legshots: number }[]
    economy: { loadout_value: number; remaining: number; weapon: (Ref & { type: string }) | null; armor: Ref | null }
}

export type Round = {
    id: number
    result: string
    ceremony: string
    winning_team: string
    plant: { round_time_in_ms: number; site: string; player: PlayerRef } | null
    defuse: { round_time_in_ms: number; player: PlayerRef } | null
    stats: RoundStat[]
}

export type Kill = {
    round: number
    time_in_round_in_ms: number
    killer: PlayerRef
    victim: PlayerRef
    assistants: PlayerRef[]
    // 'Weapon' | 'Ability' | 'Bomb' | 'Fall' — only weapons have an image.
    weapon: { id: string; name: string | null; type: string } | null
}

export type Match = {
    metadata: {
        match_id: string
        map: Ref
        game_version: string
        game_length_in_ms: number
        started_at: string
        is_completed: boolean
        queue: { id: string; name: string; mode_type: string }
        season: Season
        platform: string
        region: string
        cluster: string
    }
    players: MatchPlayer[]
    teams: MatchTeam[]
    rounds: Round[]
    kills: Kill[]
}

export type StoredMatch = {
    meta: { id: string; map: Ref; mode: string; started_at: string; season: Season; region: string; cluster: string }
    stats: {
        puuid: string
        team: string
        level: number
        character: Ref
        tier: number
        score: number
        kills: number
        deaths: number
        assists: number
        shots: { head: number; body: number; leg: number }
        damage: { made: number; received: number }
    }
    teams: { red: number | null; blue: number | null }
}

export type MmrHistoryEntry = { match_id: string; tier: Tier; map: Ref; season: Season; rr: number; last_change: number; elo: number; date: string }

/** Translation, then Henrik's name, then a readable id ('skirmish_2v2' -> 'Skirmish 2v2'). Henrik leaves names empty for new modes. */
export const queueLabel = (t: TFunction, q: { id: string; name?: string | null }) => t(`modes.${q.id}`, { defaultValue: q.name || q.id.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) })

// Henrik `mode` filter; '' = all.
export const MODES = ['', 'competitive', 'unrated', 'swiftplay', 'spikerush', 'deathmatch', 'teamdeathmatch', 'premier'] as const
export type Mode = (typeof MODES)[number]

export const fetchAccount = async (name: string, tag: string, fresh = false) => (await henrik<Account>(['v2', 'account', name, tag], { ttl: 3600, fresh })).data
export const fetchMmr = async (region: string, puuid: string, fresh = false) => (await henrik<Mmr>(['v3', 'by-puuid', 'mmr', region, PLATFORM, puuid], { ttl: 300, fresh })).data
export const fetchMatches = async (region: string, puuid: string, mode: Mode, start: number, fresh = false) =>
    (await henrik<Match[]>(['v4', 'by-puuid', 'matches', region, PLATFORM, puuid], { query: { mode, size: PAGE_SIZE, start }, ttl: start === 0 ? 120 : 1800, fresh: fresh && start === 0 })).data ?? []
/** Uncached: offset pages shift as new matches come in. */
export const fetchMatchesLive = async (region: string, puuid: string, mode: Mode, start: number) => (await henrik<Match[]>(['v4', 'by-puuid', 'matches', region, PLATFORM, puuid], { query: { mode, size: PAGE_SIZE, start }, ttl: 0 })).data ?? []
export const fetchMatch = async (region: string, id: string) => (await henrik<Match>(['v4', 'match', region, id], { ttl: null })).data
export const fetchStored = async (region: string, puuid: string, mode: Mode, fresh = false) => (await henrik<StoredMatch[]>(['v1', 'by-puuid', 'stored-matches', region, puuid], { query: { mode, page: 1, size: 200 }, ttl: 300, fresh })).data ?? []
export const fetchMmrHistory = async (region: string, puuid: string, fresh = false) => (await henrik<MmrHistoryEntry[]>(['v2', 'by-puuid', 'stored-mmr-history', region, PLATFORM, puuid], { query: { page: 1, size: 100 }, ttl: 300, fresh })).data ?? []

export const apiKeyStatus = () => invoke<boolean>('api_key_status')
export const setApiKey = (key: string) => invoke<void>('set_api_key', { key })
export const clearCache = () => invoke<void>('clear_cache')

// rev > 0 means the user hit Refresh, so the disk cache is skipped.
const noRetry = (count: number, err: unknown) => count < 1 && !(isApiError(err) && (err.kind === 'notFound' || err.kind === 'noKey' || err.kind === 'rateLimited'))

export const useAccount = (name: string, tag: string, rev: number) => useQuery({ queryKey: ['account', name.toLowerCase(), tag.toLowerCase(), rev], queryFn: () => fetchAccount(name, tag, rev > 0), staleTime: 10 * 60_000, retry: noRetry })

export const useMmr = (region: string | undefined, puuid: string | undefined, rev: number) => useQuery({ queryKey: ['mmr', puuid, rev], queryFn: () => fetchMmr(region!, puuid!, rev > 0), enabled: !!region && !!puuid, staleTime: 5 * 60_000, retry: noRetry })

export const useStored = (region: string | undefined, puuid: string | undefined, mode: Mode, rev: number) =>
    useQuery({ queryKey: ['stored', puuid, mode, rev], queryFn: () => fetchStored(region!, puuid!, mode, rev > 0), enabled: !!region && !!puuid, staleTime: 5 * 60_000, retry: noRetry })

export const useMmrHistory = (region: string | undefined, puuid: string | undefined, rev: number) => useQuery({ queryKey: ['mmrHistory', puuid, rev], queryFn: () => fetchMmrHistory(region!, puuid!, rev > 0), enabled: !!region && !!puuid, staleTime: 5 * 60_000, retry: noRetry })

// Matches opened from a list are already in the archive.
const findCachedMatch = (qc: QueryClient, id: string) => {
    for (const [, data] of qc.getQueriesData<{ matches: Match[] }>({ queryKey: ['archive'] })) {
        const hit = data?.matches.find((m) => m.metadata.match_id === id)
        if (hit) return hit
    }
    return undefined
}

export const useMatch = (region: string, id: string) => {
    const qc = useQueryClient()
    return useQuery({ queryKey: ['match', id], queryFn: () => fetchMatch(region, id), initialData: () => findCachedMatch(qc, id), staleTime: Infinity, retry: noRetry })
}
