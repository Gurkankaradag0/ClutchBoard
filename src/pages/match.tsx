import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { ArrowLeft, Bomb, ShieldCheck, Skull, Flag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ErrorState } from '@/components/error-state'
import { RankBadge } from '@/components/rank-badge'
import { profilePath } from '@/components/search/riot-id-search'
import { queueLabel, useMatch, type Match } from '@/lib/api'
import { img } from '@/lib/assets'
import { fmt, matchLines, mvps, partyGroups, rankValue, type Line, type Party } from '@/lib/stats'
import { fullDate } from '@/lib/time'
import { cn } from '@/lib/utils'

// rounds[].result: Elimination | Detonate | Defuse | Surrendered
const RESULT_ICON: Record<string, typeof Skull> = { Elimination: Skull, Detonate: Bomb, Defuse: ShieldCheck, Surrendered: Flag }

const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`

const COLS = ['stats.acs', 'stats.kills_short', 'stats.deaths_short', 'stats.assists_short', 'stats.plusMinus', 'stats.kd', 'stats.adr', 'stats.hs', 'stats.kast', 'stats.fk', 'stats.fd', 'stats.mk'] as const

// Two separate tables: shared fixed column widths keep them aligned.
// The Performance column only shows when the match has the data.
// Red means loss here, so grades use other colors.
const GRADE_TONE: Record<string, string> = { masterful: 'bg-gold/15 text-gold', distinction: 'bg-(--party-1)/15 text-(--party-1)', merit: 'bg-win/12 text-win' }

const ColGroup = ({ perf }: { perf: boolean }) => (
    <colgroup>
        <col />
        <col className="w-16" />
        {perf && <col className="w-16" />}
        {COLS.map((c) => (
            <col key={c} className={c === 'stats.mk' ? 'w-16' : 'w-14'} />
        ))}
    </colgroup>
)

const TeamTable = ({ title, score, won, lines, highlight, mvp, teamMvp, parties, perf }: { title: string; score?: number; won?: boolean; lines: Line[]; highlight?: string; mvp?: string; teamMvp: Set<string>; parties: Map<string, Party>; perf: boolean }) => {
    const { t } = useTranslation()
    return (
        <section className="overflow-hidden rounded-md border bg-card">
            <header className={cn('flex items-center justify-between border-b px-4 py-2', won === undefined ? '' : won ? 'bg-win/10' : 'bg-loss/10')}>
                <h2 className={cn('text-sm font-bold uppercase', won === undefined ? '' : won ? 'text-win' : 'text-loss')}>{title}</h2>
                {score !== undefined && <span className="font-display text-xl font-bold tabular-nums">{score}</span>}
            </header>
            <div className="overflow-x-auto">
                <table className="w-full min-w-240 table-fixed text-sm tabular-nums">
                    <ColGroup perf={perf} />
                    <thead className="text-xs text-muted-foreground uppercase">
                        <tr>
                            <th className="px-4 py-2 text-left font-medium">{t('stats.player')}</th>
                            <th className="px-2 py-2 font-medium">{t('stats.rank')}</th>
                            {perf && (
                                <th className="px-2 py-2 text-right font-medium" title={t('stats.perfHint')}>
                                    {t('stats.perf')}
                                </th>
                            )}
                            {COLS.map((c) => (
                                <th key={c} className={cn('px-2 py-2 text-right font-medium', c === 'stats.mk' && 'pr-4')}>
                                    {t(c)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {lines.map((l) => {
                            const p = l.player
                            const s = p.stats
                            const party = parties.get(p.puuid)
                            return (
                                <tr key={p.puuid} className={cn('border-t border-border/60', p.puuid === highlight && 'bg-accent')}>
                                    {/* party stripe */}
                                    <td className="px-4 py-1.5" style={party ? { boxShadow: `inset 4px 0 0 var(--party-${party.color})` } : undefined} title={party ? t('match.party', { n: party.size }) : undefined}>
                                        <span className="flex min-w-0 items-center gap-2.5">
                                            <img src={img.agent(p.agent.id)} alt={p.agent.name} title={p.agent.name} className="size-8 shrink-0 rounded-sm" loading="lazy" />
                                            <Link to={profilePath(p.name, p.tag)} title={`${p.name}#${p.tag}`} className="min-w-0 truncate font-medium hover:underline">
                                                {p.name}
                                                <span className="ml-1 text-muted-foreground">#{p.tag}</span>
                                            </Link>
                                            {p.puuid === mvp ? (
                                                <span className="shrink-0 rounded-sm bg-gold/15 px-1 text-[0.625rem] font-bold whitespace-nowrap text-gold uppercase">{t('match.mvp')}</span>
                                            ) : (
                                                teamMvp.has(p.puuid) && <span className="shrink-0 rounded-sm bg-secondary px-1 text-[0.625rem] font-bold whitespace-nowrap uppercase">{t('match.teamMvp')}</span>
                                            )}
                                            {l.grade && GRADE_TONE[l.grade] && <span className={cn('shrink-0 rounded-sm px-1 text-[0.625rem] font-bold whitespace-nowrap uppercase', GRADE_TONE[l.grade])}>{t(`grades.${l.grade}`, { defaultValue: l.grade })}</span>}
                                        </span>
                                    </td>
                                    <td className="px-2 text-center">
                                        <RankBadge tier={p.tier.id} fallbackName={p.tier.name} showName={false} />
                                    </td>
                                    {perf && (
                                        <td className="px-2 text-right font-semibold" title={l.grade ? t(`grades.${l.grade}`, { defaultValue: l.grade }) : undefined}>
                                            {l.perf === undefined ? '—' : fmt(l.perf, 0)}
                                        </td>
                                    )}
                                    <td className={cn('px-2 text-right', !perf && 'font-semibold')}>{fmt(l.acs, 0)}</td>
                                    <td className="px-2 text-right">{s.kills}</td>
                                    <td className="px-2 text-right">{s.deaths}</td>
                                    <td className="px-2 text-right">{s.assists}</td>
                                    <td className={cn('px-2 text-right', l.plusMinus > 0 ? 'text-win' : l.plusMinus < 0 ? 'text-loss' : '')}>{l.plusMinus > 0 ? `+${l.plusMinus}` : l.plusMinus}</td>
                                    <td className="px-2 text-right">{fmt(s.deaths ? s.kills / s.deaths : s.kills, 2)}</td>
                                    <td className="px-2 text-right">{fmt(l.adr, 0)}</td>
                                    <td className="px-2 text-right">{fmt(l.hs, 0)}%</td>
                                    <td className="px-2 text-right">{fmt(l.kast, 0)}%</td>
                                    <td className="px-2 text-right">{l.fk}</td>
                                    <td className="px-2 text-right">{l.fd}</td>
                                    <td className="px-2 pr-4 text-right">{l.multiKills}</td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    )
}

const Rounds = ({ m, myTeam }: { m: Match; myTeam: string }) => {
    const { t } = useTranslation()
    const [sel, setSel] = useState(0)
    const agentOf = useMemo(() => new Map(m.players.map((p) => [p.puuid, p.agent.id])), [m])
    const round = m.rounds[sel]
    const kills = m.kills.filter((k) => k.round === sel).sort((a, b) => a.time_in_round_in_ms - b.time_in_round_in_ms)
    if (!m.rounds.length) return <p className="text-sm text-muted-foreground">{t('match.noKills')}</p>

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-1" role="tablist" aria-label={t('match.rounds')}>
                {m.rounds.map((r) => {
                    const Icon = RESULT_ICON[r.result] ?? Skull
                    const ours = r.winning_team === myTeam
                    return (
                        <button
                            key={r.id}
                            type="button"
                            role="tab"
                            aria-selected={sel === r.id}
                            onClick={() => setSel(r.id)}
                            title={`${t('match.round', { n: r.id + 1 })} · ${t(`match.results.${r.result}`, { defaultValue: r.result })}`}
                            className={cn('flex w-9 flex-col items-center gap-1 rounded-sm border py-1.5 text-[0.625rem] transition-colors', ours ? 'border-win/30 bg-win/10 text-win' : 'border-loss/30 bg-loss/10 text-loss', sel === r.id && 'ring-2 ring-foreground/60')}
                        >
                            <Icon className="size-3.5" aria-hidden />
                            <span className="text-muted-foreground tabular-nums">{r.id + 1}</span>
                        </button>
                    )
                })}
            </div>
            {round && (
                <section className="rounded-md border bg-card">
                    <header className="flex items-center justify-between border-b px-4 py-2.5">
                        <h3 className="text-sm font-semibold uppercase">
                            {t('match.round', { n: round.id + 1 })} · <span className={round.winning_team === myTeam ? 'text-win' : 'text-loss'}>{t(`match.results.${round.result}`, { defaultValue: round.result })}</span>
                        </h3>
                        <span className="text-xs text-muted-foreground">{t('match.killFeed')}</span>
                    </header>
                    {kills.length ? (
                        <ul className="divide-y divide-border/60">
                            {kills.map((k, i) => (
                                <li key={i} className="flex items-center gap-3 px-4 py-2 text-sm">
                                    <span className="w-10 text-xs text-muted-foreground tabular-nums">{mmss(k.time_in_round_in_ms)}</span>
                                    <span className={cn('flex flex-1 items-center justify-end gap-2', k.killer.team === myTeam ? 'text-win' : 'text-loss')}>
                                        {k.killer.name}
                                        <img src={img.agent(agentOf.get(k.killer.puuid) ?? '')} alt="" className="size-6 rounded-sm" />
                                    </span>
                                    {k.weapon?.type === 'Weapon' && k.weapon.id ? (
                                        <img src={img.weaponKill(k.weapon.id)} alt={k.weapon.name ?? ''} title={k.weapon.name ?? undefined} className="h-5 w-16 object-contain" />
                                    ) : (
                                        <span className="w-16 truncate text-center text-xs text-muted-foreground">{k.weapon?.name ?? t(`match.killTypes.${k.weapon?.type}`, { defaultValue: '—' })}</span>
                                    )}
                                    <span className={cn('flex flex-1 items-center gap-2', k.victim.team === myTeam ? 'text-win' : 'text-loss')}>
                                        <img src={img.agent(agentOf.get(k.victim.puuid) ?? '')} alt="" className="size-6 rounded-sm opacity-60 grayscale" />
                                        {k.victim.name}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="px-4 py-3 text-sm text-muted-foreground">{t('match.noKills')}</p>
                    )}
                </section>
            )}
        </div>
    )
}

const MatchPage = () => {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { region = '', id = '' } = useParams()
    const highlight = (useLocation().state as { puuid?: string } | null)?.puuid
    const q = useMatch(region, id)

    // Performance Score order (like the in-game scoreboard), ACS before 13.06.
    const lines = useMemo(() => (q.data ? matchLines(q.data).sort((a, b) => (b.perf ?? b.acs) - (a.perf ?? a.acs)) : []), [q.data])
    const hasPerf = lines.some((l) => l.perf !== undefined)
    const mvp = useMemo(() => (q.data ? mvps(q.data) : { match: undefined, team: new Set<string>() }), [q.data])
    const parties = useMemo(() => (q.data ? partyGroups(q.data) : new Map<string, Party>()), [q.data])

    if (q.isPending) return <Skeleton className="m-8 h-96" />
    if (q.isError)
        return (
            <div className="p-8">
                <ErrorState error={q.error} notFound={t('errors.matchNotFound')} onRetry={() => void q.refetch()} />
            </div>
        )

    const m = q.data
    const me = m.players.find((p) => p.puuid === highlight)
    // Highlighted player's team first, otherwise the winners.
    const teams = [...m.teams].sort((a, b) => (a.team_id === me?.team_id ? -1 : b.team_id === me?.team_id ? 1 : Number(b.won) - Number(a.won)))
    const myTeam = me?.team_id ?? teams[0]?.team_id ?? 'Blue'
    const [first, second] = teams

    return (
        <div>
            <div className="relative overflow-hidden border-b">
                <img src={img.mapSplash(m.metadata.map.id)} alt="" className="absolute inset-0 size-full object-cover opacity-25" />
                <div className="absolute inset-0 bg-linear-to-t from-background via-background/70 to-background/30" />
                <div className="relative flex flex-wrap items-end gap-6 px-8 pt-6 pb-6">
                    <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="absolute top-4 left-6">
                        <ArrowLeft className="size-4" />
                        {t('match.back')}
                    </Button>
                    <div className="mt-10 flex-1">
                        <h1 className="text-4xl font-bold uppercase">{m.metadata.map.name}</h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {queueLabel(t, m.metadata.queue)} · {fullDate(m.metadata.started_at)} · {t('match.duration', { m: Math.round(m.metadata.game_length_in_ms / 60000) })} · {m.metadata.cluster}
                        </p>
                    </div>
                    {first && second && (
                        <p className="font-display text-5xl font-bold tabular-nums">
                            <span className={first.won ? 'text-win' : 'text-loss'}>{first.rounds.won}</span>
                            <span className="mx-3 text-muted-foreground">:</span>
                            <span className={second.won ? 'text-win' : 'text-loss'}>{second.rounds.won}</span>
                        </p>
                    )}
                </div>
            </div>
            <Tabs defaultValue="scoreboard" className="mx-auto max-w-7xl px-8 py-6">
                <TabsList>
                    <TabsTrigger value="scoreboard">{t('match.scoreboard')}</TabsTrigger>
                    {m.rounds.length > 0 && <TabsTrigger value="rounds">{t('match.rounds')}</TabsTrigger>}
                </TabsList>
                <TabsContent value="scoreboard" className="mt-4 flex flex-col gap-5">
                    {teams.length >= 2 ? (
                        teams.map((team, i) => (
                            <TeamTable
                                key={team.team_id}
                                title={i === 0 ? t('match.teamA') : t('match.teamB')}
                                score={team.rounds.won}
                                won={team.won}
                                lines={lines.filter((l) => l.player.team_id === team.team_id)}
                                highlight={highlight}
                                mvp={mvp.match}
                                teamMvp={mvp.team}
                                parties={parties}
                                perf={hasPerf}
                            />
                        ))
                    ) : (
                        <TeamTable title={queueLabel(t, m.metadata.queue)} lines={[...lines].sort((a, b) => rankValue(b.player) - rankValue(a.player))} highlight={highlight} mvp={mvp.match} teamMvp={new Set()} parties={parties} perf={hasPerf} />
                    )}
                    {parties.size > 0 && (
                        <p className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="flex gap-0.5" aria-hidden>
                                {[...new Set([...parties.values()].map((p) => p.color))].map((c) => (
                                    <span key={c} className="h-3 w-1 rounded-full" style={{ background: `var(--party-${c})` }} />
                                ))}
                            </span>
                            {t('match.partyHint')}
                        </p>
                    )}
                </TabsContent>
                <TabsContent value="rounds" className="mt-4">
                    <Rounds m={m} myTeam={myTeam} />
                </TabsContent>
            </Tabs>
        </div>
    )
}

export default MatchPage
