import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/error-state'
import { MatchRow } from '@/components/match/match-row'
import { useMmrHistory, type Match } from '@/lib/api'
import { findPlayer, fmt, matchResult, teammates } from '@/lib/stats'
import { LoadMore, TeammatesCard } from '@/components/profile/teammates'
import { SyncNote } from '@/components/profile/sync-note'
import { useArchive } from '@/lib/archive'
import { dayKey, dayLabel } from '@/lib/time'
import { useProfile } from './layout'

export const MatchListSkeleton = ({ rows = 5 }: { rows?: number }) => (
    <div className="flex flex-col gap-1.5">
        {Array.from({ length: rows }, (_, i) => (
            <Skeleton key={i} className="h-17 w-full" />
        ))}
    </div>
)

const DayHeader = ({ matches, puuid }: { matches: Match[]; puuid: string }) => {
    const { t } = useTranslation()
    const results = matches.map((m) => matchResult(m, puuid).outcome)
    const wins = results.filter((r) => r === 'win').length
    const losses = results.filter((r) => r === 'loss').length
    const draws = results.filter((r) => r === 'draw').length
    const [k, d] = matches.reduce(([k, d], m) => [k + (findPlayer(m, puuid)?.stats.kills ?? 0), d + (findPlayer(m, puuid)?.stats.deaths ?? 0)], [0, 0])
    return (
        <div className="mt-4 mb-1.5 flex items-baseline justify-between px-1 first:mt-0">
            <h3 className="text-sm font-semibold uppercase">{dayLabel(matches[0]!.metadata.started_at)}</h3>
            <p className="text-xs text-muted-foreground tabular-nums">
                <span className="text-win">
                    {wins}
                    {t('profile.winShort')}
                </span>{' '}
                {draws > 0 && (
                    <span className="text-draw">
                        {draws}
                        {t('profile.drawShort')}{' '}
                    </span>
                )}
                <span className="text-loss">
                    {losses}
                    {t('profile.lossShort')}
                </span>{' '}
                · {t('stats.kd')} {fmt(d ? k / d : k, 2)}
            </p>
        </div>
    )
}

const MatchesPage = () => {
    const { t } = useTranslation()
    const { account, mode, rev } = useProfile()
    const q = useArchive(account.region, account.puuid, mode, rev)
    const history = useMmrHistory(account.region, account.puuid, rev)

    const rr = useMemo(() => new Map(history.data?.map((h) => [h.match_id, h.last_change])), [history.data])
    const loaded = q.matches
    const days = useMemo(() => Map.groupBy(loaded, (m) => dayKey(m.metadata.started_at)), [loaded])
    // Recomputed after every page.
    const mates = useMemo(() => teammates(loaded, account.puuid), [loaded, account.puuid])

    if (q.isPending) return <MatchListSkeleton rows={8} />
    if (q.error && !loaded.length) return <ErrorState error={q.error} />
    if (days.size === 0) return <p className="text-muted-foreground">{t('profile.noMatches')}</p>

    return (
        <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[17rem_1fr]">
            <aside className="lg:sticky lg:top-16 lg:self-start">
                <TeammatesCard mates={mates} sample={loaded.length} />
            </aside>
            <div className="min-w-0">
                <SyncNote a={q} />
                {[...days.values()].map((ms) => (
                    <section key={dayKey(ms[0]!.metadata.started_at)}>
                        <DayHeader matches={ms} puuid={account.puuid} />
                        <ul className="flex flex-col gap-1.5">
                            {ms.map((m) => (
                                <MatchRow key={m.metadata.match_id} match={m} puuid={account.puuid} rrChange={rr.get(m.metadata.match_id)} />
                            ))}
                        </ul>
                    </section>
                ))}
                <LoadMore a={q} />
            </div>
        </div>
    )
}

export default MatchesPage
