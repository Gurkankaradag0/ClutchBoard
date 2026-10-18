import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/error-state'
import { RankBadge } from '@/components/rank-badge'
import { profilePath } from '@/components/search/riot-id-search'
import type { ArchiveState } from '@/lib/archive'
import { img } from '@/lib/assets'
import { fmt, mateStats, type Mate } from '@/lib/stats'
import { timeAgo } from '@/lib/time'
import { cn } from '@/lib/utils'

/** "Load more" shared by the pages that use the archive. */
export const LoadMore = ({ a }: { a: ArchiveState }) => {
    const { t } = useTranslation()
    return (
        <div className="mt-6 flex flex-col items-center gap-3">
            {!!a.error && a.matches.length > 0 && <ErrorState error={a.error} onRetry={a.loadMore} />}
            {a.hasMore ? (
                <Button variant="secondary" className="min-w-56 font-display tracking-wider uppercase" onClick={a.loadMore} disabled={a.loadingMore || a.syncing}>
                    {(a.loadingMore || a.syncing) && <Loader2 className="size-4 animate-spin" />}
                    {a.loadingMore ? t('match.loading') : a.syncing ? t('archive.syncing') : t('match.loadMore')}
                </Button>
            ) : (
                <p className="text-sm text-muted-foreground">{t('match.end')}</p>
            )}
        </div>
    )
}

/** Path to the matches shared with a player (keeps the mode filter). */
const useMatePath = () => {
    const { name = '', tag = '' } = useParams()
    const [params] = useSearchParams()
    const qs = params.toString()
    return (puuid: string) => `${profilePath(name, tag)}/players/${puuid}${qs ? `?${qs}` : ''}`
}

/** "5/7": queued together / shared matches. Links to those matches. */
export const TogetherLink = ({ mate, className }: { mate: Mate; className?: string }) => {
    const { t } = useTranslation()
    const path = useMatePath()
    return (
        <Link to={path(mate.puuid)} title={t('mates.togetherTitle', { together: mate.together, met: mate.met })} className={cn('rounded-sm px-1.5 py-0.5 font-display font-semibold tabular-nums transition-colors hover:bg-accent hover:text-foreground', className)}>
            <span className={mate.together ? 'text-gold' : 'text-muted-foreground'}>{mate.together}</span>
            <span className="text-muted-foreground">/</span>
            {mate.met}
        </Link>
    )
}

const winTone = (win: number) => (Number.isNaN(win) ? 'text-muted-foreground' : win >= 50 ? 'text-win' : 'text-loss')
const winText = (win: number) => (Number.isNaN(win) ? '—' : `${fmt(win)}%`)

/** Summary card on the Matches tab. */
export const TeammatesCard = ({ mates, sample }: { mates: Mate[]; sample: number }) => {
    const { t } = useTranslation()
    const [params] = useSearchParams()
    return (
        <section aria-labelledby="mates-h" className="overflow-hidden rounded-md border bg-card">
            <header className="border-b px-4 py-3">
                <h2 id="mates-h" className="text-sm font-semibold uppercase">
                    {t('mates.title')}
                </h2>
                <p className="text-xs text-muted-foreground">{t('mates.sample', { n: sample })}</p>
            </header>
            {mates.length ? (
                <ul className="divide-y divide-border/60">
                    {mates.slice(0, 5).map((m) => {
                        const s = mateStats(m)
                        return (
                            <li key={m.puuid} className="px-4 py-2.5">
                                <div className="flex items-center gap-2.5">
                                    <img src={img.cardSmall(m.card)} alt="" className="size-7 shrink-0 rounded-sm" loading="lazy" />
                                    <Link to={profilePath(m.name, m.tag)} title={`${m.name}#${m.tag}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
                                        {m.name}
                                        <span className="ml-1 text-muted-foreground">#{m.tag}</span>
                                    </Link>
                                    <TogetherLink mate={m} className="shrink-0 text-sm" />
                                </div>
                                <dl className="mt-1.5 grid grid-cols-2 pl-9.5 text-xs">
                                    <div>
                                        <dt className="text-muted-foreground">{t('stats.kd')}</dt>
                                        <dd className="font-display text-base font-semibold tabular-nums">{fmt(s.kd, 2)}</dd>
                                    </div>
                                    <div className="text-right">
                                        <dt className="text-muted-foreground">{t('mates.winTogether')}</dt>
                                        <dd className={cn('font-display text-base font-semibold tabular-nums', winTone(s.win))}>{winText(s.win)}</dd>
                                    </div>
                                </dl>
                            </li>
                        )
                    })}
                </ul>
            ) : (
                <p className="px-4 py-5 text-sm text-muted-foreground">{t('mates.empty')}</p>
            )}
            <div className="border-t p-3">
                <Button asChild variant="secondary" className="w-full">
                    <Link to={{ pathname: '../players', search: params.toString() }} relative="path">
                        {t('mates.details')}
                    </Link>
                </Button>
            </div>
        </section>
    )
}

const COLS = ['mates.player', 'stats.rank', 'mates.togetherMet', 'mates.sameTeam', 'mates.enemy', 'mates.winTogether', 'stats.kd', 'stats.acs', 'stats.hs', 'mates.yourKd', 'mates.last'] as const

/** Full table on the Players tab. */
export const TeammatesTable = ({ mates }: { mates: Mate[] }) => {
    const { t } = useTranslation()
    return (
        <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full min-w-240 text-sm tabular-nums">
                <thead className="text-xs text-muted-foreground uppercase">
                    <tr>
                        {COLS.map((c, i) => (
                            <th key={c} className={cn('px-3 py-2.5 font-medium whitespace-nowrap', i === 0 ? 'pl-4 text-left' : i === 1 ? 'text-center' : 'text-right', i === COLS.length - 1 && 'pr-4')}>
                                {t(c)}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {mates.map((m) => {
                        const s = mateStats(m)
                        return (
                            <tr key={m.puuid} className="border-t border-border/60">
                                <td className="py-2 pr-3 pl-4">
                                    <span className="flex min-w-0 items-center gap-2.5">
                                        <img src={img.cardSmall(m.card)} alt="" className="size-8 shrink-0 rounded-sm" loading="lazy" />
                                        <Link to={profilePath(m.name, m.tag)} className="truncate font-medium hover:underline">
                                            {m.name}
                                            <span className="ml-1 text-muted-foreground">#{m.tag}</span>
                                        </Link>
                                    </span>
                                </td>
                                <td className="px-3 text-center">{m.tier > 2 && <RankBadge tier={m.tier} fallbackName={m.tierName} showName={false} />}</td>
                                <td className="px-3 text-right">
                                    <TogetherLink mate={m} />
                                </td>
                                <td className="px-3 text-right">{m.sameTeam}</td>
                                <td className="px-3 text-right">{m.enemy}</td>
                                <td className={cn('px-3 text-right', winTone(s.win))}>{winText(s.win)}</td>
                                <td className="px-3 text-right">{fmt(s.kd, 2)}</td>
                                <td className="px-3 text-right">{fmt(s.acs, 0)}</td>
                                <td className="px-3 text-right">{fmt(s.hs, 0)}%</td>
                                <td className={cn('px-3 text-right', s.myKd >= 1 ? 'text-win' : 'text-loss')}>{fmt(s.myKd, 2)}</td>
                                <td className="py-2 pr-4 pl-3 text-right whitespace-nowrap text-muted-foreground">{timeAgo(m.last)}</td>
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </div>
    )
}
