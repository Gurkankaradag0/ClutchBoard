import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { TierName } from '@/components/rank-badge'
import type { MmrHistoryEntry } from '@/lib/api'
import { fullDate } from '@/lib/time'
import { cn } from '@/lib/utils'

const LIMIT = 40
// Vertical padding (%) so end points and rings aren't clipped.
const PAD = 8

const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

/**
 * Elo line (tier × 100 + RR). The SVG only draws the line/area; points, crosshair and tooltip live in
 * an HTML layer because circles would stretch in a non-uniform viewBox. Snaps to the nearest match;
 * arrow keys step through matches.
 */
export const RrChart = ({ history }: { history: MmrHistoryEntry[] }) => {
    const { t } = useTranslation()
    const [active, setActive] = useState<number | null>(null)
    const pts = history.slice(0, LIMIT).reverse() // oldest first
    if (pts.length < 2) return <p className="text-sm text-muted-foreground">{t('profile.noRrHistory')}</p>

    const unit = t('profile.rrUnit')
    const elos = pts.map((p) => p.elo)
    const min = Math.min(...elos)
    const max = Math.max(...elos)
    const span = Math.max(1, max - min)
    const pos = pts.map((p, i) => ({ x: (i / (pts.length - 1)) * 100, y: PAD + (1 - (p.elo - min) / span) * (100 - 2 * PAD) }))
    const line = pos.map(({ x, y }, i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
    // Tier boundaries in range, at most 4.
    const bounds = Array.from({ length: Math.floor(max / 100) - Math.ceil(min / 100) + 1 }, (_, i) => (Math.ceil(min / 100) + i) * 100)
        .filter((e) => e > min && e < max)
        .slice(0, 4)
        .map((e) => PAD + (1 - (e - min) / span) * (100 - 2 * PAD))
    const net = pts.reduce((s, p) => s + p.last_change, 0)
    const last = pts.at(-1)!

    const pick = (e: PointerEvent<HTMLDivElement>) => {
        const r = e.currentTarget.getBoundingClientRect()
        const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
        setActive(Math.round(frac * (pts.length - 1)))
    }
    const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault()
        setActive((i) => Math.min(pts.length - 1, Math.max(0, (i ?? pts.length - 1) + (e.key === 'ArrowRight' ? 1 : -1))))
    }

    const a = active === null ? null : { p: pts[active]!, ...pos[active]! }
    // Tooltip sits beside the point, vertically centered, so it never leaves the card.
    const toRight = a ? a.x < 50 : true

    return (
        <div>
            <div className="mb-2 flex items-baseline justify-between">
                <TierName tier={last.tier.id} fallbackName={last.tier.name} />
                <span className={cn('font-display text-sm font-semibold tabular-nums', net >= 0 ? 'text-win' : 'text-loss')}>
                    {signed(net)} {unit}
                </span>
            </div>

            <div
                role="img"
                tabIndex={0}
                aria-label={t('profile.rrChartLabel', { n: pts.length, net: signed(net), unit })}
                onPointerMove={pick}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(pts.length - 1)}
                onBlur={() => setActive(null)}
                onKeyDown={onKey}
                className="relative h-28 cursor-crosshair rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
                    {bounds.map((y) => (
                        <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                    ))}
                    <path d={`${line} L100,100 L0,100 Z`} fill="var(--primary)" opacity="0.1" />
                    <path d={line} fill="none" stroke="var(--primary)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
                </svg>

                {a && (
                    <>
                        <span className="pointer-events-none absolute inset-y-0 w-px bg-foreground/25" style={{ left: `${a.x}%` }} aria-hidden />
                        {pos.map((p, i) => (
                            <span key={pts[i]!.match_id} className="pointer-events-none absolute size-1.5 -translate-1/2 rounded-full bg-primary/60" style={{ left: `${p.x}%`, top: `${p.y}%` }} aria-hidden />
                        ))}
                        <span className="pointer-events-none absolute size-2.5 -translate-1/2 rounded-full bg-primary ring-2 ring-card" style={{ left: `${a.x}%`, top: `${a.y}%` }} aria-hidden />
                        <div aria-live="polite" className={cn('pointer-events-none absolute top-1/2 z-10 w-max min-w-32 -translate-y-1/2 rounded-md border bg-popover px-3 py-2 shadow-lg', toRight ? 'ml-3' : '-ml-3 -translate-x-full')} style={{ left: `${a.x}%` }}>
                            <p className="font-display text-lg leading-tight font-bold tabular-nums">
                                {a.p.rr} {unit}
                            </p>
                            <TierName tier={a.p.tier.id} fallbackName={a.p.tier.name} className="text-sm" />
                            <p className={cn('mt-1 text-sm font-semibold tabular-nums', a.p.last_change > 0 ? 'text-win' : a.p.last_change < 0 ? 'text-loss' : 'text-muted-foreground')}>
                                {signed(a.p.last_change)} {unit}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {a.p.map.name} · {fullDate(a.p.date)}
                            </p>
                        </div>
                    </>
                )}
            </div>

            <div className="mt-2 flex flex-wrap gap-1" aria-hidden>
                {pts.slice(-20).map((p) => (
                    <span key={p.match_id} title={`${p.map.name} ${signed(p.last_change)} ${unit}`} className={cn('h-1.5 w-2.5 rounded-full', p.last_change > 0 ? 'bg-win' : p.last_change < 0 ? 'bg-loss' : 'bg-draw')} />
                ))}
            </div>
        </div>
    )
}
