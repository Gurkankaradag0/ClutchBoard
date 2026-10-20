import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { RankBadge, TierName } from '@/components/rank-badge'
import { fetchAccountByPuuid, fetchMatches, fetchMmr, isApiError, queueLabel, type Match } from '@/lib/api'
import { img } from '@/lib/assets'
import { findPlayer, matchResult } from '@/lib/stats'
import { timeAgo } from '@/lib/time'
import { cn } from '@/lib/utils'

const OUTCOME = { win: 'bg-win', loss: 'bg-loss', draw: 'bg-draw' } as const
const OUTCOME_TEXT = { win: 'text-win', loss: 'text-loss', draw: 'text-draw' } as const

// Henrik is asked once per window (a right-click); no polling.
const ONCE = { staleTime: Infinity, retry: false, refetchOnWindowFocus: false } as const

const Row = ({ m, puuid }: { m: Match; puuid: string }) => {
    const { t } = useTranslation()
    const me = findPlayer(m, puuid)
    if (!me) return null
    const res = matchResult(m, puuid)
    return (
        <li className="relative flex items-center gap-2.5 overflow-hidden rounded-md bg-white/5 py-1.5 pr-2.5 pl-3">
            <span className={cn('absolute inset-y-0 left-0 w-1', OUTCOME[res.outcome])} aria-hidden />
            <img src={img.agent(me.agent.id)} alt={me.agent.name} title={me.agent.name} className="size-8 rounded-sm bg-black/30" loading="lazy" />
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{m.metadata.map.name}</p>
                <p className="truncate text-[0.6875rem] text-muted-foreground">
                    {queueLabel(t, m.metadata.queue)} · {timeAgo(m.metadata.started_at)}
                </p>
            </div>
            <p className={cn('font-display text-sm font-bold tabular-nums', OUTCOME_TEXT[res.outcome])}>{res.placement !== undefined ? `#${res.placement}` : `${res.us}:${res.them}`}</p>
            <p className="w-16 text-right font-display text-xs font-semibold tabular-nums">
                {me.stats.kills}/{me.stats.deaths}/{me.stats.assists}
            </p>
        </li>
    )
}

/** A friend's Valorant career (`career-<puuid>`): rank and the latest matches, from Henrik. */
export const CareerPanel = ({ id }: { active: boolean; id: string }) => {
    const { t } = useTranslation()
    const puuid = id.slice('career-'.length)
    const account = useQuery({ queryKey: ['career', 'account', puuid], queryFn: () => fetchAccountByPuuid(puuid), ...ONCE })
    const region = account.data?.region
    const mmr = useQuery({ queryKey: ['career', 'mmr', puuid], queryFn: () => fetchMmr(region!, puuid), enabled: !!region, ...ONCE })
    const matches = useQuery({ queryKey: ['career', 'matches', puuid], queryFn: () => fetchMatches(region!, puuid, '', 0), enabled: !!region, ...ONCE })

    const error = account.error ?? mmr.error ?? matches.error
    if (error) {
        const message = !isApiError(error) ? t('errors.unknown') : error.kind === 'noKey' ? t('errors.noKey') : error.kind === 'notFound' ? t('chat.noValorant') : error.kind === 'rateLimited' ? t('errors.rateLimited', { n: error.retryAfter }) : error.message
        return <p className="p-2 text-xs text-muted-foreground">{message}</p>
    }
    if (account.isPending || mmr.isPending) return <p className="p-2 text-xs text-muted-foreground">{t('match.loading')}</p>

    const current = mmr.data?.current
    const peak = mmr.data?.peak
    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 rounded-md bg-white/5 p-2.5">
                <RankBadge tier={current?.tier.id ?? 0} fallbackName={current?.tier.name} size="md" showName={false} />
                <div className="min-w-0 flex-1">
                    <TierName tier={current?.tier.id ?? 0} fallbackName={current?.tier.name} className="block text-base" />
                    <p className="text-xs text-muted-foreground tabular-nums">
                        {current && current.tier.id >= 3 && `${current.rr} ${t('profile.rrUnit')} · `}
                        {account.data && t('profile.level', { n: account.data.account_level })}
                    </p>
                </div>
                {peak && peak.tier.id >= 3 && (
                    <div className="text-right">
                        <p className="text-[0.6875rem] text-muted-foreground uppercase">{t('profile.peak')}</p>
                        <TierName tier={peak.tier.id} fallbackName={peak.tier.name} className="text-sm" />
                    </div>
                )}
            </div>
            {matches.isPending ? (
                <p className="p-2 text-xs text-muted-foreground">{t('match.loading')}</p>
            ) : matches.data?.length ? (
                <ul className="flex flex-col gap-1.5">
                    {matches.data.map((m) => (
                        <Row key={m.metadata.match_id} m={m} puuid={puuid} />
                    ))}
                </ul>
            ) : (
                <p className="p-2 text-xs text-muted-foreground">{t('chat.noMatches')}</p>
            )}
        </div>
    )
}
