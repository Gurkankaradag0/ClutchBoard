import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

// valorant-api.com uuids match the ids Henrik returns. Images are built from media URLs directly.
const MEDIA = 'https://media.valorant-api.com'
const API = 'https://valorant-api.com/v1'

// Current competitive tier table (last entry of /v1/competitivetiers).
// Pinned; update if Riot ships a new table.
const TIER_TABLE = '03621f52-342b-cf4e-4f86-9350a49c6d04'

export const img = {
    agent: (id: string) => `${MEDIA}/agents/${id}/displayicon.png`,
    agentPortrait: (id: string) => `${MEDIA}/agents/${id}/fullportrait.png`,
    map: (id: string) => `${MEDIA}/maps/${id}/listviewicon.png`,
    mapSplash: (id: string) => `${MEDIA}/maps/${id}/splash.png`,
    weapon: (id: string) => `${MEDIA}/weapons/${id}/displayicon.png`,
    weaponKill: (id: string) => `${MEDIA}/weapons/${id}/killstreamicon.png`,
    cardSmall: (id: string) => `${MEDIA}/playercards/${id}/smallart.png`,
    cardWide: (id: string) => `${MEDIA}/playercards/${id}/wideart.png`,
    cardLarge: (id: string) => `${MEDIA}/playercards/${id}/largeart.png`,
    tier: (tier: number) => `${MEDIA}/competitivetiers/${TIER_TABLE}/${tier}/largeicon.png`,
    tierSmall: (tier: number) => `${MEDIA}/competitivetiers/${TIER_TABLE}/${tier}/smallicon.png`
}

const apiLang = (lng: string) => (lng.startsWith('tr') ? 'tr-TR' : 'en-US')

const getJson = async <T>(path: string, lng: string) => {
    const res = await fetch(`${API}${path}${path.includes('?') ? '&' : '?'}language=${apiLang(lng)}`)
    if (!res.ok) throw new Error(`valorant-api ${res.status}`)
    return ((await res.json()) as { data: T }).data
}

// Static content; once per session is enough.
const STATIC = { staleTime: Infinity, gcTime: Infinity, retry: 1 } as const

type TierRow = { tier: number; tierName: string; color: string }

export const useTiers = () => {
    const { i18n } = useTranslation()
    return useQuery({
        queryKey: ['va', 'tiers', i18n.language],
        queryFn: async () => {
            const tables = await getJson<{ uuid: string; tiers: TierRow[] }[]>('/competitivetiers', i18n.language)
            const table = tables.find((t) => t.uuid === TIER_TABLE) ?? tables.at(-1)
            return new Map((table?.tiers ?? []).map((t) => [t.tier, t]))
        },
        ...STATIC
    })
}

export const useTitle = (id: string | undefined) => {
    const { i18n } = useTranslation()
    return useQuery({ queryKey: ['va', 'title', id, i18n.language], queryFn: () => getJson<{ titleText: string | null }>(`/playertitles/${id}`, i18n.language), enabled: !!id, ...STATIC })
}

// Tier colors are 'RRGGBBAA' hex.
export const tierColor = (row: TierRow | undefined) => (row ? `#${row.color.slice(0, 6)}` : undefined)
