import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { ChevronRight } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/error-state'
import { MatchRow } from '@/components/match/match-row'
import { RankBadge, TierName } from '@/components/rank-badge'
import { useMmrHistory, useStored, type Mmr } from '@/lib/api'
import { useArchive } from '@/lib/archive'
import { img } from '@/lib/assets'
import { aggregate, avgPerformance, derived, fmt, groupBy, knownOutcomes, weaponKills, type Agg } from '@/lib/stats'
import { cn } from '@/lib/utils'
import { RrChart } from '@/components/profile/rr-chart'
import { MatchListSkeleton } from './matches'
import { useProfile } from './layout'

/** 'e11a5' → 'E11 A5' */
const actLabel = (short: string) => short.toUpperCase().replace(/A/, ' A')

const Panel = ({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) => (
    <section className={cn('rounded-md border bg-card', className)}>
        <header className="flex items-center justify-between border-b px-4 py-2.5">
            <h2 className="text-sm font-semibold uppercase">{title}</h2>
            {aside}
        </header>
        <div className="p-4">{children}</div>
    </section>
)

const RankPanel = ({ mmr }: { mmr: Mmr }) => {
    const { t } = useTranslation()
    const acts = mmr.seasonal
        .filter((s) => s.games > 0)
        .slice(-8)
        .reverse()
    return (
        <Panel title={t('stats.rank')}>
            <div className="grid grid-cols-2 gap-4">
                {/* Icon above the name so long names fit */}
                <div className="min-w-0">
                    <p className="mb-1.5 text-xs text-muted-foreground uppercase">{t('profile.current')}</p>
                    <RankBadge tier={mmr.current.tier.id} fallbackName={mmr.current.tier.name} size="md" showName={false} />
                    <TierName tier={mmr.current.tier.id} fallbackName={mmr.current.tier.name} className="mt-1 block truncate" />
                    {mmr.current.tier.id >= 3 && <p className="mt-1 text-sm text-muted-foreground tabular-nums">{t('profile.rr', { n: mmr.current.rr })}</p>}
                </div>
                {mmr.peak && (
                    <div className="min-w-0">
                        <p className="mb-1.5 text-xs text-muted-foreground uppercase">{t('profile.peak')}</p>
                        <RankBadge tier={mmr.peak.tier.id} fallbackName={mmr.peak.tier.name} size="md" showName={false} />
                        <TierName tier={mmr.peak.tier.id} fallbackName={mmr.peak.tier.name} className="mt-1 block truncate" />
                        <p className="mt-1 text-sm text-muted-foreground">{actLabel(mmr.peak.season.short)}</p>
                    </div>
                )}
            </div>
            {acts.length > 0 && (
                <>
                    <h3 className="mt-5 mb-2 text-xs font-semibold text-muted-foreground uppercase">{t('profile.acts')}</h3>
                    <ul className="flex flex-col gap-1">
                        {acts.map((a) => (
                            <li key={a.season.id} className="flex items-center gap-3 rounded-sm px-1 py-1 text-sm">
                                <span className="w-14 font-display text-xs text-muted-foreground">{actLabel(a.season.short)}</span>
                                <RankBadge tier={a.end_tier.id} fallbackName={a.end_tier.name} size="xs" showName={false} />
                                <TierName tier={a.end_tier.id} fallbackName={a.end_tier.name} className="flex-1 text-sm" />
                                {/* Season `wins` exclude placement wins, so losses aren't derived from it. */}
                                <span className="text-xs text-muted-foreground tabular-nums" title={t('profile.actWinsHint')}>
                                    {t('profile.actGames', { games: a.games, wins: a.wins })}
                                </span>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </Panel>
    )
}

const Big = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
    <div>
        <p className="text-xs text-muted-foreground uppercase">{label}</p>
        <p className={cn('font-display text-3xl font-bold tabular-nums', tone)}>{value}</p>
    </div>
)

const Small = ({ label, value }: { label: string; value: string }) => (
    <div className="rounded-sm bg-background/50 px-3 py-2">
        <p className="truncate text-[0.6875rem] text-muted-foreground uppercase" title={label}>
            {label}
        </p>
        <p className="truncate font-display text-lg font-semibold tabular-nums">{value}</p>
    </div>
)

const Summary = ({ agg, perf }: { agg: Agg; perf: ReturnType<typeof avgPerformance> }) => {
    const { t } = useTranslation()
    const d = derived(agg)
    return (
        <>
            <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
                <Big label={t('stats.kd')} value={fmt(d.kd, 2)} tone={d.kd >= 1 ? 'text-win' : 'text-loss'} />
                <Big label={t('stats.win')} value={`${fmt(d.win)}%`} />
                {/* stored-matches has no Performance Score; average comes from loaded matches */}
                {perf ? <Big label={t('stats.perfAvg', { n: perf.n })} value={fmt(perf.avg, 0)} /> : <Big label={t('stats.acs')} value={fmt(d.acs, 0)} />}
                <Big label={t('stats.hs')} value={`${fmt(d.hs)}%`} />
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2 md:grid-cols-6">
                <Small label={t('profile.matchesCount')} value={String(agg.games)} />
                <Small label={t('profile.recordShort')} value={`${agg.wins} / ${agg.draws} / ${agg.losses}`} />
                <Small label={t('stats.kda')} value={fmt(d.kda, 2)} />
                <Small label={t('stats.adr')} value={fmt(d.adr, 0)} />
                <Small label={t('stats.kpr')} value={fmt(d.kpr, 2)} />
                {perf ? <Small label={t('stats.acs')} value={fmt(d.acs, 0)} /> : <Small label={t('stats.kills')} value={agg.kills.toLocaleString()} />}
            </div>
        </>
    )
}

const AgentTable = ({ rows }: { rows: ReturnType<typeof groupBy> }) => {
    const { t } = useTranslation()
    return (
        <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground uppercase">
                <tr>
                    <th className="pb-2 font-medium">{t('stats.agent')}</th>
                    {['profile.matchesCount', 'stats.win', 'stats.kd', 'stats.acs', 'stats.adr', 'stats.hs'].map((k) => (
                        <th key={k} className="pb-2 text-right font-medium">
                            {t(k)}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody className="tabular-nums">
                {rows.slice(0, 8).map((r) => {
                    const d = derived(r.agg)
                    return (
                        <tr key={r.id} className="border-t border-border/60">
                            <td className="py-1.5">
                                <span className="flex items-center gap-2">
                                    <img src={img.agent(r.id)} alt="" className="size-7 rounded-sm" loading="lazy" />
                                    <span className="font-medium">{r.name}</span>
                                </span>
                            </td>
                            <td className="text-right">{r.agg.games}</td>
                            <td className={cn('text-right', d.win >= 50 ? 'text-win' : 'text-loss')}>{fmt(d.win, 0)}%</td>
                            <td className="text-right">{fmt(d.kd, 2)}</td>
                            <td className="text-right">{fmt(d.acs, 0)}</td>
                            <td className="text-right">{fmt(d.adr, 0)}</td>
                            <td className="text-right">{fmt(d.hs, 0)}%</td>
                        </tr>
                    )
                })}
            </tbody>
        </table>
    )
}

const MapList = ({ rows }: { rows: ReturnType<typeof groupBy> }) => {
    const { t } = useTranslation()
    return (
        <ul className="flex flex-col gap-2">
            {rows.slice(0, 8).map((r) => {
                const d = derived(r.agg)
                return (
                    <li key={r.id} className="relative flex h-12 items-center overflow-hidden rounded-sm">
                        <img src={img.map(r.id)} alt="" className="absolute inset-0 size-full object-cover opacity-30" loading="lazy" />
                        <div className="relative flex w-full items-center justify-between px-3">
                            <span className="font-display font-semibold">{r.name}</span>
                            <span className="text-sm tabular-nums">
                                <span className={d.win >= 50 ? 'text-win' : 'text-loss'}>{fmt(d.win, 0)}%</span>
                                <span className="ml-2 text-muted-foreground">
                                    {r.agg.wins}
                                    {t('profile.winShort')} {r.agg.draws > 0 && `${r.agg.draws}${t('profile.drawShort')} `}
                                    {r.agg.losses}
                                    {t('profile.lossShort')}
                                </span>
                            </span>
                        </div>
                    </li>
                )
            })}
        </ul>
    )
}

const WeaponList = ({ rows }: { rows: ReturnType<typeof weaponKills> }) => {
    const total = rows.reduce((s, r) => s + r.kills, 0)
    return (
        <ul className="flex flex-col gap-3">
            {rows.slice(0, 6).map((r) => (
                <li key={r.id} className="flex items-center gap-3">
                    <img src={img.weaponKill(r.id)} alt="" className="h-6 w-20 object-contain" loading="lazy" />
                    <div className="flex-1">
                        <div className="flex justify-between text-sm">
                            <span>{r.name}</span>
                            <span className="tabular-nums">{r.kills}</span>
                        </div>
                        <div className="mt-1 h-1 rounded-full bg-background">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${(r.kills / total) * 100}%` }} />
                        </div>
                    </div>
                </li>
            ))}
        </ul>
    )
}

const OverviewPage = () => {
    const { t } = useTranslation()
    const { account, mmr, mmrLoading, mode, rev } = useProfile()
    const stored = useStored(account.region, account.puuid, mode, rev)
    const history = useMmrHistory(account.region, account.puuid, rev)
    const archive = useArchive(account.region, account.puuid, mode, rev)
    const [season, setSeason] = useState<string>()
    const [params] = useSearchParams()

    const seasons = useMemo(() => [...new Map((stored.data ?? []).map((m) => [m.meta.season.id, m.meta.season.short])).entries()], [stored.data])
    const activeSeason = season ?? seasons[0]?.[0] ?? 'all'
    const filtered = useMemo(() => (stored.data ?? []).filter((m) => activeSeason === 'all' || m.meta.season.id === activeSeason), [stored.data, activeSeason])
    const loaded = archive.matches
    // Real results from loaded matches override score-based guesses.
    const known = useMemo(() => knownOutcomes(loaded, account.puuid), [loaded, account.puuid])
    const agg = useMemo(() => aggregate(filtered, known), [filtered, known])
    const agents = useMemo(() => groupBy(filtered, (m) => m.stats.character, known), [filtered, known])
    const maps = useMemo(() => groupBy(filtered, (m) => m.meta.map, known), [filtered, known])
    const perf = useMemo(() => avgPerformance(loaded, account.puuid), [loaded, account.puuid])
    const weapons = useMemo(() => weaponKills(loaded, account.puuid), [loaded, account.puuid])
    const rr = useMemo(() => new Map(history.data?.map((h) => [h.match_id, h.last_change])), [history.data])

    return (
        <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-[20rem_1fr]">
            <div className="flex flex-col gap-5">
                {mmrLoading ? <Skeleton className="h-72" /> : mmr && <RankPanel mmr={mmr} />}
                <Panel title={t('profile.rrHistory')}>{history.isPending ? <Skeleton className="h-28" /> : <RrChart history={history.data ?? []} />}</Panel>
                {weapons.length > 0 && (
                    <Panel title={t('profile.weapons')} aside={<span className="text-xs text-muted-foreground">{t('profile.weaponsHint', { n: loaded.length })}</span>}>
                        <WeaponList rows={weapons} />
                    </Panel>
                )}
            </div>
            <div className="flex min-w-0 flex-col gap-5">
                <Panel
                    title={t('profile.summary')}
                    aside={
                        seasons.length > 0 && (
                            <Select value={activeSeason} onValueChange={setSeason}>
                                <SelectTrigger size="sm" className="h-7 w-36" aria-label={t('profile.season')}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {seasons.map(([id, short]) => (
                                        <SelectItem key={id} value={id}>
                                            {actLabel(short)}
                                        </SelectItem>
                                    ))}
                                    <SelectItem value="all">{t('profile.allSeasons')}</SelectItem>
                                </SelectContent>
                            </Select>
                        )
                    }
                >
                    {stored.isPending ? (
                        <Skeleton className="h-36" />
                    ) : stored.isError ? (
                        <ErrorState error={stored.error} onRetry={() => void stored.refetch()} />
                    ) : agg.games ? (
                        <Summary agg={agg} perf={perf} />
                    ) : (
                        <p className="text-sm text-muted-foreground">{t('profile.noMatches')}</p>
                    )}
                </Panel>
                {agents.length > 0 && (
                    <div className="grid gap-5 xl:grid-cols-[1fr_18rem]">
                        <Panel title={t('profile.topAgents')}>
                            <AgentTable rows={agents} />
                        </Panel>
                        <Panel title={t('profile.topMaps')}>
                            <MapList rows={maps} />
                        </Panel>
                    </div>
                )}
                <Panel
                    title={t('profile.recentMatches')}
                    aside={
                        <Link to={{ pathname: 'matches', search: params.toString() }} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                            {t('profile.viewAll')}
                            <ChevronRight className="size-3.5" />
                        </Link>
                    }
                >
                    {archive.isPending ? (
                        <MatchListSkeleton rows={4} />
                    ) : archive.error && !loaded.length ? (
                        <ErrorState error={archive.error} />
                    ) : loaded.length ? (
                        <ul className="flex flex-col gap-1.5">
                            {loaded.slice(0, 5).map((m) => (
                                <MatchRow key={m.metadata.match_id} match={m} puuid={account.puuid} rrChange={rr.get(m.metadata.match_id)} />
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-muted-foreground">{t('profile.noMatches')}</p>
                    )}
                </Panel>
            </div>
        </div>
    )
}

export default OverviewPage
