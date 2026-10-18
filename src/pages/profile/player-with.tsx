import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { ErrorState } from '@/components/error-state'
import { useArchive } from '@/lib/archive'
import { MatchRow } from '@/components/match/match-row'
import { RankBadge } from '@/components/rank-badge'
import { LoadMore } from '@/components/profile/teammates'
import { profilePath } from '@/components/search/riot-id-search'
import { useMmrHistory } from '@/lib/api'
import { img } from '@/lib/assets'
import { findPlayer, fmt, mateStats, teammates, type Relation } from '@/lib/stats'
import { cn } from '@/lib/utils'
import { MatchListSkeleton } from './matches'
import { useProfile } from './layout'

const REL_TONE: Record<Relation, string> = { together: 'bg-gold/15 text-gold', team: 'bg-win/12 text-win', enemy: 'bg-loss/12 text-loss' }

const Stat = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
    <div className="min-w-0">
        <p className="truncate text-[0.6875rem] text-muted-foreground uppercase">{label}</p>
        <p className={cn('font-display text-xl font-bold tabular-nums', tone)}>{value}</p>
    </div>
)

/** Loaded matches shared with one player. */
const PlayerWithPage = () => {
    const { t } = useTranslation()
    const { mate: matePuuid = '' } = useParams()
    const { account, mode, rev } = useProfile()
    const q = useArchive(account.region, account.puuid, mode, rev)
    const history = useMmrHistory(account.region, account.puuid, rev)
    const loaded = q.matches
    const mate = useMemo(() => teammates(loaded, account.puuid).find((m) => m.puuid === matePuuid), [loaded, account.puuid, matePuuid])
    const shared = useMemo(() => loaded.filter((m) => mate?.matches[m.metadata.match_id]), [loaded, mate])
    const rr = useMemo(() => new Map(history.data?.map((h) => [h.match_id, h.last_change])), [history.data])

    if (q.isPending) return <MatchListSkeleton rows={6} />
    if (q.error && !loaded.length) return <ErrorState error={q.error} />
    if (!mate)
        return (
            <div className="mx-auto max-w-6xl">
                <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">{t('mates.notInLoaded')}</p>
                <LoadMore a={q} />
            </div>
        )

    const s = mateStats(mate)
    return (
        <div className="mx-auto max-w-6xl">
            <section className="mb-5 flex flex-wrap items-center gap-x-8 gap-y-4 rounded-md border bg-card p-4">
                <div className="flex min-w-0 items-center gap-3">
                    <img src={img.cardSmall(mate.card)} alt="" className="size-14 shrink-0 rounded-sm" />
                    <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">{t('mates.with', { name: account.name })}</p>
                        <Link to={profilePath(mate.name, mate.tag)} className="block truncate font-display text-2xl font-bold hover:underline">
                            {mate.name}
                            <span className="ml-1.5 text-lg text-muted-foreground">#{mate.tag}</span>
                        </Link>
                    </div>
                    {mate.tier > 2 && <RankBadge tier={mate.tier} fallbackName={mate.tierName} size="md" showName={false} />}
                </div>
                <div className="grid flex-1 grid-cols-3 gap-4 sm:grid-cols-6">
                    <Stat label={t('mates.togetherMet')} value={`${mate.together}/${mate.met}`} tone="text-gold" />
                    <Stat label={t('mates.sameTeam')} value={`${mate.wins}${t('profile.winShort')} ${mate.losses}${t('profile.lossShort')}`} />
                    <Stat label={t('mates.enemy')} value={String(mate.enemy)} />
                    <Stat label={t('stats.win')} value={Number.isNaN(s.win) ? '—' : `${fmt(s.win)}%`} tone={Number.isNaN(s.win) ? undefined : s.win >= 50 ? 'text-win' : 'text-loss'} />
                    <Stat label={t('mates.theirKd')} value={fmt(s.kd, 2)} />
                    <Stat label={t('mates.yourKd')} value={fmt(s.myKd, 2)} tone={s.myKd >= 1 ? 'text-win' : 'text-loss'} />
                </div>
            </section>

            <p className="mb-2 text-xs text-muted-foreground">{t('mates.sharedHint', { n: loaded.length })}</p>
            <ul className="flex flex-col gap-1.5">
                {shared.map((m) => {
                    const rel = mate.matches[m.metadata.match_id]!
                    const them = findPlayer(m, mate.puuid)
                    return (
                        <MatchRow
                            key={m.metadata.match_id}
                            match={m}
                            puuid={account.puuid}
                            rrChange={rr.get(m.metadata.match_id)}
                            extra={
                                <p className="mt-1 flex items-center gap-1.5 text-[0.6875rem]">
                                    <span className={cn('rounded-sm px-1 font-semibold uppercase', REL_TONE[rel])}>{t(`mates.rel.${rel}`)}</span>
                                    {them && <img src={img.agent(them.agent.id)} alt={them.agent.name} title={`${mate.name}: ${them.agent.name} · ${them.stats.kills}/${them.stats.deaths}/${them.stats.assists}`} className="size-4 rounded-sm" />}
                                </p>
                            }
                        />
                    )
                })}
            </ul>
            <LoadMore a={q} />
        </div>
    )
}

export default PlayerWithPage
