import { layerColor, type Layer, type Lines, type Rgba } from '@/lib/crosshair'
import { cn } from '@/lib/utils'

const fill = (c: Rgba, opacity: number) => `rgba(${c.r},${c.g},${c.b},${Math.max(0, Math.min(1, (c.a / 255) * opacity))})`

type Rect = [x: number, y: number, w: number, h: number]

const arms = (l: Lines): Rect[] => {
    if (!l.bShowLines || l.lineLength <= 0 || l.lineThickness <= 0) return []
    const t = l.lineThickness
    const h = l.lineLength
    const v = l.bAllowVertScaling ? l.lineLengthVertical : l.lineLength
    const o = l.lineOffset
    return [
        [-o - h, -t / 2, h, t],
        [o, -t / 2, h, t],
        [-t / 2, -o - v, t, v],
        [-t / 2, o, t, v]
    ]
}

/** Primary crosshair at rest (no movement/firing spread), drawn in game pixels. */
export const CrosshairPreview = ({ layer, size = 96, className }: { layer: Layer; size?: number; className?: string }) => {
    const color = layerColor(layer)
    const groups: { rects: Rect[]; opacity: number }[] = [
        { rects: arms(layer.outerLines), opacity: layer.outerLines.opacity },
        { rects: arms(layer.innerLines), opacity: layer.innerLines.opacity },
        { rects: layer.bDisplayCenterDot && layer.centerDotSize > 0 ? [[-layer.centerDotSize / 2, -layer.centerDotSize / 2, layer.centerDotSize, layer.centerDotSize]] : [], opacity: layer.centerDotOpacity }
    ]
    const ot = layer.bHasOutline ? layer.outlineThickness : 0
    const outline = fill(layer.outlineColor, layer.outlineOpacity)
    // 48 game px across, so long lines still fit.
    const view = 48
    return (
        <svg viewBox={`${-view / 2} ${-view / 2} ${view} ${view}`} width={size} height={size} className={cn('shrink-0 rounded-md bg-[#5b6672]', className)} shapeRendering="crispEdges" aria-hidden>
            {groups.map((g, i) => (
                <g key={i}>
                    {ot > 0 && g.rects.map(([x, y, w, h], j) => <rect key={j} x={x - ot} y={y - ot} width={w + ot * 2} height={h + ot * 2} fill={outline} />)}
                    {g.rects.map(([x, y, w, h], j) => (
                        <rect key={j} x={x} y={y} width={w} height={h} fill={fill(color, g.opacity)} />
                    ))}
                </g>
            ))}
        </svg>
    )
}
