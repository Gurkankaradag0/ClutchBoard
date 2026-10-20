import { useQuery } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { LoadoutView } from '@/components/local/loadout-view'
import { livePlayers, matchLoadouts, useSkinIndex, type LiveMatch } from '@/lib/local'

/** A live match player's full loadout (`inventory-<puuid>`), like the Live Match page dialog. Read once per window. */
export const InventoryPanel = ({ id, title }: { active: boolean; id: string; title: string }) => {
    const { t } = useTranslation()
    const puuid = id.slice('inventory-'.length)
    const q = useQuery({ queryKey: ['inventory', puuid], queryFn: () => invoke<LiveMatch | null>('local_live_match', { puuid: null }), staleTime: Infinity, refetchOnWindowFocus: false, retry: false })
    const index = useSkinIndex(!!q.data)
    const loadout = q.data ? matchLoadouts(q.data).get(puuid) : undefined
    const identity = q.data ? livePlayers(q.data).find((p) => p.Subject === puuid)?.PlayerIdentity : undefined

    if (q.isPending) return <p className="p-2 text-xs text-muted-foreground">{t('match.loading')}</p>
    if (!loadout) return <p className="p-2 text-xs text-muted-foreground">{t('local.noMatch')}</p>
    if (!index.data) return <p className="p-2 text-xs text-muted-foreground">{t('match.loading')}</p>
    return <LoadoutView identity={identity ?? {}} name={<span className="font-medium">{title}</span>} guns={loadout.guns} expressions={loadout.expressions} index={index.data} />
}
