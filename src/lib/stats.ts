import type { Match, MatchPlayer, StoredMatch } from './api'

export type Outcome = 'win' | 'loss' | 'draw'

const ratio = (a: number, b: number) => (b > 0 ? a / b : 0)
export const pct = (a: number, b: number) => ratio(a, b) * 100

// Single match

export const roundCount = (m: Match) => m.rounds.length || Math.max(1, ...m.teams.map((t) => t.rounds.won + t.rounds.lost))

export const findPlayer = (m: Match, puuid: string) => m.players.find((p) => p.puuid === puuid)

/** Player's team score first. Deathmatch has no teams, so placement 1 counts as a win. */
export const matchResult = (m: Match, puuid: string): { outcome: Outcome; us: number; them: number; placement?: number } => {
    const me = findPlayer(m, puuid)
    const mine = m.teams.find((t) => t.team_id === me?.team_id)
    if (!mine || m.teams.length < 2) {
        const placement = [...m.players].sort((a, b) => b.stats.score - a.stats.score).findIndex((p) => p.puuid === puuid) + 1
        return { outcome: placement === 1 ? 'win' : 'loss', us: me?.stats.kills ?? 0, them: me?.stats.deaths ?? 0, placement }
    }
    const { won: us, lost: them } = mine.rounds
    // Use `won`: a surrendered match can end level (3–3). A draw means neither team won.
    return { outcome: mine.won ? 'win' : m.teams.some((t) => t.won) ? 'loss' : 'draw', us, them }
}

export type Line = {
    player: MatchPlayer
    /** Riot Performance Score (0–500); undefined before patch 13.06 */
    perf?: number
    grade?: string
    acs: number
    adr: number
    hs: number
    kast: number
    fk: number
    fd: number
    plusMinus: number
    multiKills: number
}

// A death counts as traded (the T in KAST) if a teammate kills the killer within 3s.
const TRADE_MS = 3000

export const matchLines = (m: Match): Line[] => {
    const rounds = roundCount(m)
    const kast = new Map<string, Set<number>>()
    const fk = new Map<string, number>()
    const fd = new Map<string, number>()
    const multi = new Map<string, number>()
    const mark = (puuid: string, round: number) => (kast.get(puuid) ?? kast.set(puuid, new Set()).get(puuid)!).add(round)
    const inc = (map: Map<string, number>, k: string) => map.set(k, (map.get(k) ?? 0) + 1)

    const byRound = Map.groupBy(m.kills, (k) => k.round)
    for (const [round, kills] of byRound) {
        const sorted = [...kills].sort((a, b) => a.time_in_round_in_ms - b.time_in_round_in_ms)
        const first = sorted[0]
        if (first) {
            inc(fk, first.killer.puuid)
            inc(fd, first.victim.puuid)
        }
        const dead = new Set<string>()
        const perKiller = new Map<string, number>()
        for (const k of sorted) {
            dead.add(k.victim.puuid)
            if (k.killer.puuid !== k.victim.puuid) {
                mark(k.killer.puuid, round)
                inc(perKiller, k.killer.puuid)
            }
            k.assistants.forEach((a) => mark(a.puuid, round))
            const traded = sorted.some((t) => t.victim.puuid === k.killer.puuid && t.killer.team === k.victim.team && t.time_in_round_in_ms - k.time_in_round_in_ms <= TRADE_MS && t.time_in_round_in_ms >= k.time_in_round_in_ms)
            if (traded) mark(k.victim.puuid, round)
        }
        for (const [p, n] of perKiller) if (n >= 3) inc(multi, p)
        for (const p of m.players) if (!dead.has(p.puuid)) mark(p.puuid, round)
    }

    return m.players.map((p) => {
        const s = p.stats
        return {
            player: p,
            perf: p.performance?.score,
            grade: p.performance?.ratings.grade,
            acs: ratio(s.score, rounds),
            adr: ratio(s.damage.dealt, rounds),
            hs: pct(s.headshots, s.headshots + s.bodyshots + s.legshots),
            kast: m.kills.length ? pct(kast.get(p.puuid)?.size ?? 0, rounds) : 0,
            fk: fk.get(p.puuid) ?? 0,
            fd: fd.get(p.puuid) ?? 0,
            plusMinus: s.kills - s.deaths,
            multiKills: multi.get(p.puuid) ?? 0
        }
    })
}

export type Party = { color: number; size: number }

/** Parties of 2+ (same party_id) -> group color per puuid. Unique across the match, so two duos on one
 *  team get different colors. Solo players get none. */
export const partyGroups = (m: Match) => {
    const out = new Map<string, Party>()
    let next = 0
    for (const members of Map.groupBy(m.players, (p) => `${p.team_id}:${p.party_id}`).values()) {
        if (members.length < 2) continue
        const party = { color: next++ % 5, size: members.length }
        for (const p of members) out.set(p.puuid, party)
    }
    return out
}

/** Ranking/MVP value: Performance Score since 13.06, combat score before. */
export const rankValue = (p: MatchPlayer) => p.performance?.score ?? p.stats.score

/** Match MVP and team MVPs. */
export const mvps = (m: Match) => {
    const top = (ps: MatchPlayer[]) => ps.reduce<MatchPlayer | undefined>((a, b) => (!a || rankValue(b) > rankValue(a) ? b : a), undefined)?.puuid
    const match = top(m.players)
    const team = new Set(m.teams.map((t) => top(m.players.filter((p) => p.team_id === t.team_id))).filter((x): x is string => !!x))
    return { match, team }
}

// Many matches (stored-matches)

export type Agg = { games: number; wins: number; losses: number; draws: number; kills: number; deaths: number; assists: number; rounds: number; score: number; damage: number; head: number; body: number; leg: number }

const empty = (): Agg => ({ games: 0, wins: 0, losses: 0, draws: 0, kills: 0, deaths: 0, assists: 0, rounds: 0, score: 0, damage: 0, head: 0, body: 0, leg: 0 })

/**
 * stored-matches has no result field, so it's derived from the score (wrong for level surrenders).
 * `known` holds real results from loaded full matches and takes priority.
 */
export type KnownOutcomes = Map<string, Outcome>

export const knownOutcomes = (ms: Match[], puuid: string): KnownOutcomes => new Map(ms.filter((m) => findPlayer(m, puuid)).map((m) => [m.metadata.match_id, matchResult(m, puuid).outcome]))

export const storedOutcome = (m: StoredMatch, known?: KnownOutcomes): Outcome | null => {
    const real = known?.get(m.meta.id)
    if (real) return real
    const { red, blue } = m.teams
    if (red == null || blue == null) return null
    const [us, them] = m.stats.team.toLowerCase() === 'red' ? [red, blue] : [blue, red]
    return us > them ? 'win' : us < them ? 'loss' : 'draw'
}

const add = (a: Agg, m: StoredMatch, known?: KnownOutcomes) => {
    const s = m.stats
    const o = storedOutcome(m, known)
    a.games++
    if (o === 'win') a.wins++
    else if (o === 'loss') a.losses++
    else if (o === 'draw') a.draws++
    a.kills += s.kills
    a.deaths += s.deaths
    a.assists += s.assists
    a.rounds += (m.teams.red ?? 0) + (m.teams.blue ?? 0)
    a.score += s.score
    a.damage += s.damage.made
    a.head += s.shots.head
    a.body += s.shots.body
    a.leg += s.shots.leg
    return a
}

export const aggregate = (ms: StoredMatch[], known?: KnownOutcomes) => ms.reduce((a, m) => add(a, m, known), empty())

export const derived = (a: Agg) => ({
    kd: ratio(a.kills, a.deaths),
    kda: ratio(a.kills + a.assists, a.deaths),
    hs: pct(a.head, a.head + a.body + a.leg),
    win: pct(a.wins, a.wins + a.losses + a.draws),
    acs: ratio(a.score, a.rounds),
    adr: ratio(a.damage, a.rounds),
    kpr: ratio(a.kills, a.rounds)
})

export const groupBy = (ms: StoredMatch[], key: (m: StoredMatch) => { id: string; name: string }, known?: KnownOutcomes) => {
    const out = new Map<string, { id: string; name: string; agg: Agg }>()
    for (const m of ms) {
        const k = key(m)
        const row = out.get(k.id) ?? out.set(k.id, { ...k, agg: empty() }).get(k.id)!
        add(row.agg, m, known)
    }
    return [...out.values()].sort((a, b) => b.agg.games - a.agg.games)
}

/** Average Performance Score over loaded matches (13.06+ only); null without data. */
export const avgPerformance = (ms: Match[], puuid: string) => {
    const scores = ms.map((m) => findPlayer(m, puuid)?.performance?.score).filter((s): s is number => typeof s === 'number')
    return scores.length ? { avg: scores.reduce((a, b) => a + b, 0) / scores.length, n: scores.length } : null
}

// Weapons (loaded matches)

export const weaponKills = (ms: Match[], puuid: string) => {
    const out = new Map<string, { id: string; name: string; kills: number }>()
    for (const m of ms)
        for (const k of m.kills) {
            if (k.killer.puuid !== puuid || !k.weapon?.id || !k.weapon.name || k.weapon.type !== 'Weapon' || k.victim.puuid === puuid) continue
            const row = out.get(k.weapon.id) ?? out.set(k.weapon.id, { id: k.weapon.id, name: k.weapon.name, kills: 0 }).get(k.weapon.id)!
            row.kills++
        }
    return [...out.values()].sort((a, b) => b.kills - a.kills)
}

// Players met (loaded matches)

// Henrik has no "played with" endpoint and stored-matches lacks other players, so this uses loaded
// matches. Everyone in the match counts; `together` means same team and same party_id.
export type Relation = 'together' | 'team' | 'enemy'

export type Mate = {
    puuid: string
    name: string
    tag: string
    card: string
    tier: number
    tierName: string
    /** Matches shared */
    met: number
    /** Matches queued together */
    together: number
    sameTeam: number
    enemy: number
    /** Results on the same team only */
    wins: number
    losses: number
    kills: number
    deaths: number
    assists: number
    score: number
    rounds: number
    head: number
    shots: number
    myKills: number
    myDeaths: number
    last: string
    /** match_id -> relation */
    matches: Record<string, Relation>
}

export const relationOf = (me: MatchPlayer, p: MatchPlayer): Relation => (p.team_id !== me.team_id ? 'enemy' : me.party_id && p.party_id === me.party_id ? 'together' : 'team')

export const teammates = (ms: Match[], puuid: string) => {
    const out = new Map<string, Mate>()
    for (const m of ms) {
        const me = findPlayer(m, puuid)
        if (!me) continue
        const { outcome } = matchResult(m, puuid)
        const rounds = roundCount(m)
        for (const p of m.players) {
            if (p.puuid === puuid) continue
            const rel = relationOf(me, p)
            // Newest first, so the first name/rank seen is the latest.
            const row =
                out.get(p.puuid) ??
                out
                    .set(p.puuid, {
                        puuid: p.puuid,
                        name: p.name,
                        tag: p.tag,
                        card: p.customization.card,
                        tier: p.tier.id,
                        tierName: p.tier.name,
                        met: 0,
                        together: 0,
                        sameTeam: 0,
                        enemy: 0,
                        wins: 0,
                        losses: 0,
                        kills: 0,
                        deaths: 0,
                        assists: 0,
                        score: 0,
                        rounds: 0,
                        head: 0,
                        shots: 0,
                        myKills: 0,
                        myDeaths: 0,
                        last: m.metadata.started_at,
                        matches: {}
                    })
                    .get(p.puuid)!
            const s = p.stats
            row.met++
            row.matches[m.metadata.match_id] = rel
            if (rel === 'enemy') row.enemy++
            else {
                row.sameTeam++
                if (rel === 'together') row.together++
                if (outcome === 'win') row.wins++
                else if (outcome === 'loss') row.losses++
            }
            row.kills += s.kills
            row.deaths += s.deaths
            row.assists += s.assists
            row.score += s.score
            row.rounds += rounds
            row.head += s.headshots
            row.shots += s.headshots + s.bodyshots + s.legshots
            row.myKills += me.stats.kills
            row.myDeaths += me.stats.deaths
        }
    }
    // Shared matches, then matches together, then most recent.
    return [...out.values()].sort((a, b) => b.met - a.met || b.together - a.together || b.last.localeCompare(a.last))
}

export const mateStats = (r: Mate) => ({ kd: ratio(r.kills, r.deaths), win: r.wins + r.losses ? pct(r.wins, r.wins + r.losses) : NaN, acs: ratio(r.score, r.rounds), hs: pct(r.head, r.shots), myKd: ratio(r.myKills, r.myDeaths) })

// Formatting

export const fmt = (n: number, digits = 1) => (Number.isFinite(n) ? n.toFixed(digits) : '—')
export const fmtInt = (n: number) => Math.round(n).toLocaleString()
