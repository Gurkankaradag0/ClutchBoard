import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { RankBadge } from '@/components/rank-badge'
import { queueLabel, type Match } from '@/lib/api'
import { img } from '@/lib/assets'
import { findPlayer, fmt, matchLines, matchResult, mvps, pct } from '@/lib/stats'
import { clock } from '@/lib/time'
import { cn } from '@/lib/utils'

const OUTCOME = { win: 'bg-win', loss: 'bg-loss', draw: 'bg-draw' } as const
const OUTCOME_TEXT = { win: 'text-win', loss: 'text-loss', draw: 'text-draw' } as const
const OUTCOME_TINT = { win: 'from-win/12', loss: 'from-loss/12', draw: 'from-draw/12' } as const

// Rows are containers so secondary cells hide in narrow columns.
const Cell = ({ label, value, className, wide }: { label: string; value: string; className?: string; wide?: boolean }) => (
    <div className={cn('hidden min-w-14 text-right', wide ? '@4xl:block' : '@2xl:block')}>
        <p className={cn('font-display text-base font-semibold tabular-nums', className)}>{value}</p>
        <p className="text-[0.6875rem] text-muted-foreground uppercase">{label}</p>
    </div>
)

/** `extra` renders a small line under the map name. */
type Props = { match: Match; puuid: string; rrChange?: number; extra?: ReactNode }

export const MatchRow = ({ match: m, puuid, rrChange, extra }: Props) => {
    const { t } = useTranslation()
    const line = useMemo(() => matchLines(m).find((l) => l.player.puuid === puuid), [m, puuid])
    const { match: matchMvp, team: teamMvp } = useMemo(() => mvps(m), [m])
    const me = findPlayer(m, puuid)
    if (!me) return null

    const res = matchResult(m, puuid)
    const s = me.stats
    const deathmatch = res.placement !== undefined

    const badge = deathmatch ? t('match.placement', { n: res.placement }) : matchMvp === puuid ? t('match.mvp') : teamMvp.has(puuid) ? t('match.teamMvp') : null

    return (
        <li className="@container">
            <Link to={`/match/${m.metadata.region}/${m.metadata.match_id}`} state={{ puuid }} className="group relative flex items-center gap-4 overflow-hidden rounded-md bg-card py-2.5 pr-4 pl-5 transition-colors hover:bg-accent/70">
                <span className={cn('absolute inset-y-0 left-0 w-1', OUTCOME[res.outcome])} aria-hidden />
                <span className={cn('absolute inset-y-0 left-0 w-1/3 bg-linear-to-r to-transparent', OUTCOME_TINT[res.outcome])} aria-hidden />
                <img src={img.agent(me.agent.id)} alt={me.agent.name} title={me.agent.name} className="relative size-12 rounded-sm bg-background/60" loading="lazy" />
                <div className="relative w-32 min-w-0 shrink-0">
                    <p className="truncate font-display font-semibold">{m.metadata.map.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                        {queueLabel(t, m.metadata.queue)} · {clock(m.metadata.started_at)}
                    </p>
                    {extra}
                </div>
                <div className="w-20 shrink-0">
                    <p className={cn('font-display text-xl font-bold tabular-nums', OUTCOME_TEXT[res.outcome])}>{deathmatch ? `#${res.placement}` : `${res.us} : ${res.them}`}</p>
                    <p className="text-[0.6875rem] text-muted-foreground uppercase">{t(`match.${res.outcome}`)}</p>
                </div>
                {me.tier.id > 0 && <RankBadge tier={me.tier.id} fallbackName={me.tier.name} size="md" showName={false} />}
                <div className="min-w-24">
                    <p className="font-display text-base font-semibold tabular-nums">
                        {s.kills} <span className="text-muted-foreground">/</span> {s.deaths} <span className="text-muted-foreground">/</span> {s.assists}
                    </p>
                    <p className="text-[0.6875rem] text-muted-foreground uppercase">K / D / A</p>
                </div>
                <div className="ml-auto flex items-center gap-5">
                    <Cell label={t('stats.kd')} value={fmt(s.deaths ? s.kills / s.deaths : s.kills)} className={s.kills >= s.deaths ? 'text-win' : 'text-loss'} />
                    <Cell wide label={t('stats.hs')} value={`${fmt(pct(s.headshots, s.headshots + s.bodyshots + s.legshots), 0)}%`} />
                    <Cell wide label={t('stats.adr')} value={fmt(line?.adr ?? 0, 0)} />
                    {/* Performance Score (13.06+), otherwise ACS */}
                    {line?.perf !== undefined ? <Cell label={t('stats.perf')} value={fmt(line.perf, 0)} /> : <Cell label={t('stats.acs')} value={fmt(line?.acs ?? 0, 0)} />}
                    <div className="w-24 text-right whitespace-nowrap">
                        {badge && <span className={cn('rounded-sm px-1.5 py-0.5 font-display text-xs font-bold tracking-wider uppercase', matchMvp === puuid ? 'bg-gold/15 text-gold' : 'bg-secondary text-secondary-foreground')}>{badge}</span>}
                        {rrChange !== undefined && (
                            <p className={cn('mt-1 font-display text-sm font-semibold tabular-nums', rrChange > 0 ? 'text-win' : rrChange < 0 ? 'text-loss' : 'text-muted-foreground')}>
                                {rrChange > 0 ? `+${rrChange}` : rrChange} {t('profile.rrUnit')}
                            </p>
                        )}
                    </div>
                </div>
            </Link>
        </li>
    )
}
