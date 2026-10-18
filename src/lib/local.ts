import { invoke } from '@tauri-apps/api/core'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { fetchMatches } from '@/lib/api'
import type { Party } from '@/lib/stats'

// Local Riot Client bridge (riot_local.rs, read-only). null when closed, error string on failure.
// Riot payloads are PascalCase and change between patches, so these types are loose.

export type LocalStatus = { puuid: string; region: string; shard: string }

export type Identity = { Subject?: string; PlayerCardID?: string; PlayerTitleID?: string; AccountLevel?: number; Incognito?: boolean; HideAccountLevel?: boolean; PreferredLevelBorderID?: string }

type Expression = { AssetID?: string; TypeID?: string }
type SpraySel = { SprayID?: string }

export type PersonalGun = { ID: string; SkinID?: string; SkinLevelID?: string; ChromaID?: string; CharmLevelID?: string }
export type MyLoadout = {
    puuid: string
    region: string
    loadout: { Subject: string; Guns?: PersonalGun[]; Sprays?: SpraySel[]; ActiveExpressions?: Expression[]; Identity?: Identity; Incognito?: boolean }
}

type SocketItem = { ID: string; Item: { ID: string; TypeID: string } }
type MatchLoadout = { Subject: string; Items?: Record<string, { ID: string; TypeID: string; Sockets?: Record<string, SocketItem> }>; Sprays?: { SpraySelections?: SpraySel[] }; Expressions?: { AESSelections?: Expression[] } }

export type LivePlayer = { Subject: string; TeamID?: string; CharacterID?: string; CharacterSelectionState?: string; PlayerIdentity?: Identity; CompetitiveTier?: number }

export type LiveMatch = {
    phase: 'core-game' | 'pregame'
    puuid: string
    /** Player whose match this is (you or a searched profile). */
    target: string
    region: string
    match: { MapID?: string; ModeID?: string; QueueID?: string; Players?: LivePlayer[]; AllyTeam?: { TeamID: string; Players: LivePlayer[] } }
    // core-game: { Loadouts: [{ CharacterID, Loadout }] }, pregame: { Loadouts: [Loadout] }
    loadouts: { Loadouts?: (MatchLoadout | { CharacterID: string; Loadout: MatchLoadout })[] } | null
    names: { Subject: string; GameName: string; TagLine: string }[] | null
    /** puuid -> partyId (your party + friends' presences). */
    parties: Record<string, string>
}

// Polling only while My Account / Live Match is open: local status every 5s while closed,
// live match every 10s to catch agent select -> in game.
const STATUS_POLL = 5_000
const LIVE_POLL = 10_000

export const useLocalStatus = (poll = false) =>
    useQuery({ queryKey: ['local', 'status'], queryFn: () => invoke<LocalStatus | null>('local_status'), staleTime: STATUS_POLL, refetchOnWindowFocus: true, refetchInterval: (q) => (poll && !q.state.data ? STATUS_POLL : false), retry: false })

export const useMyLoadout = (enabled: boolean) => useQuery({ queryKey: ['local', 'loadout'], queryFn: () => invoke<MyLoadout | null>('local_my_loadout'), enabled, staleTime: 60_000, refetchOnWindowFocus: true, retry: false })

export const useLiveMatch = (enabled: boolean, target?: string) =>
    useQuery({ queryKey: ['local', 'live', target ?? 'me'], queryFn: () => invoke<LiveMatch | null>('local_live_match', { puuid: target ?? null }), enabled, staleTime: LIVE_POLL, refetchInterval: enabled ? LIVE_POLL : false, refetchOnWindowFocus: true, retry: false })

/**
 * Is a searched player in a match right now? Riot may refuse this for other players; the button just
 * stays hidden then. No polling.
 */
export const useLiveOf = (puuid: string | undefined, enabled: boolean) =>
    useQuery({ queryKey: ['local', 'live', puuid], queryFn: () => invoke<LiveMatch | null>('local_live_match', { puuid }), enabled: enabled && !!puuid, staleTime: 30_000, refetchOnWindowFocus: true, retry: false, throwOnError: false })

// Loadouts

const CHROMA_TYPE = '3ad1b2b2-acdb-4524-852f-954a76ddae0a'
const BUDDY_TYPE = 'dd3bf334-87f3-40bd-b043-682a57a8dc3a'
const SPRAY_TYPE = 'd5f120f8-ff8c-4aac-92ea-f2b5acbe9475'
const EMPTY = new Set(['', '00000000-0000-0000-0000-000000000000', '90f0a554-41b3-355b-6846-74a27aa3f7b9'])

export type Equipped = { weaponId: string; chromaId?: string; skinId?: string; buddyLevelId?: string }
export type ExpressionItem = { id: string; kind: 'spray' | 'flex' }
export type PlayerLoadout = { guns: Equipped[]; expressions: ExpressionItem[] }

const toExpressions = (sprays: SpraySel[] = [], aes: Expression[] = []): ExpressionItem[] => {
    // Newer payloads use AESSelections (sprays + flex), older ones SpraySelections.
    const items = aes.length ? aes.map((e) => ({ id: e.AssetID ?? '', kind: (e.TypeID?.toLowerCase() === SPRAY_TYPE ? 'spray' : 'flex') as ExpressionItem['kind'] })) : sprays.map((s) => ({ id: s.SprayID ?? '', kind: 'spray' as const }))
    return items.filter((i) => !EMPTY.has(i.id.toLowerCase()))
}

export const fromPersonal = (l: MyLoadout['loadout']): PlayerLoadout => ({
    guns: (l.Guns ?? []).map((g) => ({ weaponId: g.ID.toLowerCase(), chromaId: g.ChromaID, skinId: g.SkinID, buddyLevelId: g.CharmLevelID })),
    expressions: toExpressions(l.Sprays, l.ActiveExpressions)
})

const fromMatch = (l: MatchLoadout): PlayerLoadout => ({
    guns: Object.entries(l.Items ?? {}).map(([weaponId, item]) => {
        const sockets = Object.values(item.Sockets ?? {})
        const of = (type: string) => sockets.find((s) => s.Item.TypeID === type)?.Item.ID
        return { weaponId: weaponId.toLowerCase(), chromaId: of(CHROMA_TYPE), buddyLevelId: of(BUDDY_TYPE) }
    }),
    expressions: toExpressions(l.Sprays?.SpraySelections, l.Expressions?.AESSelections)
})

/** puuid -> loadout, for both pregame and core-game shapes. */
export const matchLoadouts = (live: LiveMatch) => {
    const out = new Map<string, PlayerLoadout>()
    for (const entry of live.loadouts?.Loadouts ?? []) {
        const l = 'Loadout' in entry ? entry.Loadout : entry
        out.set(l.Subject, fromMatch(l))
    }
    return out
}

export const livePlayers = (live: LiveMatch) => live.match.Players ?? live.match.AllyTeam?.Players ?? []

/** Parties of 2+ in the match -> color per puuid (same --party-N palette as the scoreboard). */
export const liveParties = (live: LiveMatch) => {
    const present = new Set(livePlayers(live).map((p) => p.Subject))
    const groups = Map.groupBy(
        Object.entries(live.parties ?? {}).filter(([puuid]) => present.has(puuid)),
        ([, pid]) => pid
    )
    const out = new Map<string, Party>()
    let next = 0
    for (const members of groups.values()) {
        if (members.length < 2) continue
        const party = { color: next++ % 5, size: members.length }
        for (const [puuid] of members) out.set(puuid, party)
    }
    return out
}

// Hidden names (on request, one player at a time)

export type RevealedName = { name: string; tag: string }
/** Why each step failed, shown in the tooltip. */
export type RevealResult = RevealedName | { failed: string[] }

const why = (e: unknown) => (typeof e === 'object' && e && 'kind' in e ? String((e as { kind: string }).kind) : String(e))

/**
 * Tries Henrik by puuid (cached, forced, v1), then the duo's Henrik match history,
 * then Riot's name-service as a last resort.
 */
export const revealName = async (puuid: string, region: string, duos: string[]): Promise<RevealResult> => {
    const failed: string[] = []
    const henrikTries: { label: string; path: string[]; query: [string, string][]; fresh: boolean }[] = [
        { label: 'Henrik v2', path: ['v2', 'by-puuid', 'account', puuid], query: [], fresh: false },
        { label: 'Henrik v2 force', path: ['v2', 'by-puuid', 'account', puuid], query: [['force', 'true']], fresh: true },
        { label: 'Henrik v1', path: ['v1', 'by-puuid', 'account', puuid], query: [], fresh: false }
    ]
    for (const tr of henrikTries) {
        try {
            const r = await invoke<{ data?: { name?: string; tag?: string } }>('henrik', { path: tr.path, query: tr.query, ttl: 3600, fresh: tr.fresh })
            if (r.data?.name) return { name: r.data.name, tag: r.data.tag ?? '' }
            failed.push(`${tr.label}: empty`)
        } catch (e) {
            failed.push(`${tr.label}: ${why(e)}`)
        }
    }
    for (const duo of duos) {
        try {
            const hit = (await fetchMatches(region, duo, '', 0)).flatMap((m) => m.players).find((p) => p.puuid === puuid)
            if (hit?.name) return { name: hit.name, tag: hit.tag }
            failed.push('duo history: not found')
        } catch (e) {
            failed.push(`duo history: ${why(e)}`)
        }
    }
    try {
        const n = await invoke<{ GameName: string; TagLine: string } | null>('local_name', { puuid })
        if (n?.GameName) return { name: n.GameName, tag: n.TagLine }
        failed.push('name-service: empty')
    } catch (e) {
        failed.push(`name-service: ${why(e)}`)
    }
    return { failed }
}

// Skin index (valorant-api.com)

type VaWeapon = {
    uuid: string
    displayName: string
    category: string
    displayIcon: string
    shopData: { cost: number } | null
    skins: { uuid: string; displayName: string; displayIcon: string | null; contentTierUuid: string | null; chromas: { uuid: string; displayName: string; displayIcon: string | null; fullRender: string | null }[]; levels: { uuid: string; displayIcon: string | null }[] }[]
}

export type SkinInfo = { weaponId: string; weaponName: string; category: string; cost: number; skinName: string; image: string; tierColor?: string }

const CATEGORY_ORDER = ['Sidearm', 'SMG', 'Shotgun', 'Rifle', 'Sniper', 'Heavy', 'Melee']
export const categoryRank = (c: string) => CATEGORY_ORDER.indexOf(c.replace('EEquippableCategory::', ''))

/** chroma/skin/level uuid -> image + name; `order` is the buy menu order (category, price). */
export const useSkinIndex = (enabled: boolean) => {
    const { i18n } = useTranslation()
    return useQuery({
        queryKey: ['va', 'skins', i18n.language],
        enabled,
        staleTime: Infinity,
        gcTime: Infinity,
        queryFn: async () => {
            const lang = i18n.language === 'tr' ? 'tr-TR' : 'en-US'
            const [weapons, tiers] = await Promise.all([
                fetch(`https://valorant-api.com/v1/weapons?language=${lang}`).then((r) => r.json() as Promise<{ data: VaWeapon[] }>),
                fetch('https://valorant-api.com/v1/contenttiers').then((r) => r.json() as Promise<{ data: { uuid: string; highlightColor: string }[] }>)
            ])
            const tierColor = new Map(tiers.data.map((t) => [t.uuid, `#${t.highlightColor.slice(0, 6)}`]))
            const byId = new Map<string, SkinInfo>()
            const weaponsById = new Map<string, SkinInfo>()
            for (const w of weapons.data) {
                const base = { weaponId: w.uuid, weaponName: w.displayName, category: w.category.replace('EEquippableCategory::', ''), cost: w.shopData?.cost ?? 0 }
                weaponsById.set(w.uuid, { ...base, skinName: w.displayName, image: w.displayIcon })
                for (const s of w.skins) {
                    const info = (image: string | null | undefined): SkinInfo => ({ ...base, skinName: s.displayName, image: image ?? s.displayIcon ?? w.displayIcon, tierColor: s.contentTierUuid ? tierColor.get(s.contentTierUuid) : undefined })
                    byId.set(s.uuid, info(s.chromas[0]?.fullRender ?? s.displayIcon))
                    for (const c of s.chromas) byId.set(c.uuid, { ...info(c.fullRender ?? c.displayIcon), skinName: c.displayName || s.displayName })
                    for (const l of s.levels) byId.set(l.uuid, info(s.chromas[0]?.fullRender ?? l.displayIcon))
                }
            }
            const order = [...weaponsById.values()].sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || a.cost - b.cost).map((w) => w.weaponId)
            return { byId, weaponsById, order }
        }
    })
}

export type SkinIndex = NonNullable<ReturnType<typeof useSkinIndex>['data']>

export const resolveSkin = (index: SkinIndex, e: Equipped) => (e.chromaId && index.byId.get(e.chromaId.toLowerCase())) || (e.skinId && index.byId.get(e.skinId.toLowerCase())) || index.weaponsById.get(e.weaponId)

export const buddyImg = (levelId: string) => `https://media.valorant-api.com/buddylevels/${levelId}/displayicon.png`
export const expressionImg = (e: ExpressionItem) => `https://media.valorant-api.com/${e.kind === 'spray' ? 'sprays' : 'flex'}/${e.id}/displayicon.png`
export const levelBorderImg = (id: string) => `https://media.valorant-api.com/levelborders/${id}/levelnumberappearance.png`

/** The local "tr" deployment is "eu" on Henrik. */
export const henrikRegion = (region: string) => (['eu', 'na', 'latam', 'br', 'ap', 'kr'].includes(region) ? region : 'eu')
