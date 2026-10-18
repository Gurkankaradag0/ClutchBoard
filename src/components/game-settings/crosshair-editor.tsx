import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CrosshairPreview } from '@/components/game-settings/crosshair-preview'
import { PRESET_COLORS, encodeCrosshair, fromCss, toCss, type Layer, type Lines, type Profile, type Rgba } from '@/lib/crosshair'
import { cn } from '@/lib/utils'

// A preset color is stored as the preset, anything else as custom, like the game does.
const isPreset = (c: Rgba) => PRESET_COLORS.some((p) => toCss(p) === toCss(c))

// Ranges follow the in-game sliders.
const Range = ({ label, value, min, max, step = 1, onChange, disabled }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; disabled?: boolean }) => (
    <label className={cn('grid grid-cols-[9rem_1fr_3.5rem] items-center gap-3 text-sm', disabled && 'opacity-40')}>
        <span className="truncate text-muted-foreground">{label}</span>
        <input type="range" className="accent-primary" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
        <input
            type="number"
            className="h-7 rounded-md border bg-transparent px-1.5 text-right text-xs tabular-nums"
            min={min}
            max={max}
            step={step}
            value={Math.round(value * 1000) / 1000}
            disabled={disabled}
            onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value))))}
            aria-label={label}
        />
    </label>
)

const Toggle = ({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) => (
    <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>
            {label}
            {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
        </span>
    </label>
)

const ColorField = ({ label, value, onChange, presets = true }: { label: string; value: Rgba; onChange: (c: Rgba) => void; presets?: boolean }) => {
    const [text, setText] = useState(toCss(value))
    const set = (c: Rgba) => {
        setText(toCss(c))
        onChange(c)
    }
    return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-36 shrink-0 text-muted-foreground">{label}</span>
            <input type="color" className="h-8 w-10 cursor-pointer rounded border bg-transparent" value={toCss(value)} onChange={(e) => set(fromCss(e.target.value, value.a) ?? value)} aria-label={label} />
            <Input
                className="h-8 w-28 font-mono text-xs"
                value={text}
                spellCheck={false}
                onChange={(e) => {
                    setText(e.target.value)
                    const c = fromCss(e.target.value, value.a)
                    if (c) onChange(c)
                }}
                aria-label={`${label} hex`}
            />
            {presets && (
                <span className="flex gap-1">
                    {PRESET_COLORS.map((c) => (
                        <button key={toCss(c)} type="button" className="size-5 rounded-sm border border-black/40" style={{ background: toCss(c) }} onClick={() => set(c)} aria-label={toCss(c)} />
                    ))}
                </span>
            )}
        </div>
    )
}

const LinesEditor = ({ title, lines, onChange }: { title: string; lines: Lines; onChange: (l: Lines) => void }) => {
    const { t } = useTranslation()
    const set = (patch: Partial<Lines>) => onChange({ ...lines, ...patch })
    const off = !lines.bShowLines
    return (
        <fieldset className="flex flex-col gap-2 rounded-md border p-3">
            <legend className="px-1 text-xs font-semibold uppercase">{title}</legend>
            <Toggle label={t('gs.editor.showLines')} checked={lines.bShowLines} onChange={(v) => set({ bShowLines: v })} />
            <Range label={t('gs.editor.opacity')} value={lines.opacity} min={0} max={1} step={0.01} onChange={(v) => set({ opacity: v })} disabled={off} />
            <Range label={t('gs.editor.length')} value={lines.lineLength} min={0} max={20} onChange={(v) => set({ lineLength: v, ...(lines.bAllowVertScaling ? {} : { lineLengthVertical: v }) })} disabled={off} />
            <Toggle label={t('gs.editor.vertical')} checked={lines.bAllowVertScaling} onChange={(v) => set({ bAllowVertScaling: v, lineLengthVertical: v ? lines.lineLengthVertical : lines.lineLength })} />
            {lines.bAllowVertScaling && <Range label={t('gs.editor.verticalLength')} value={lines.lineLengthVertical} min={0} max={20} onChange={(v) => set({ lineLengthVertical: v })} disabled={off} />}
            <Range label={t('gs.editor.thickness')} value={lines.lineThickness} min={0} max={10} onChange={(v) => set({ lineThickness: v })} disabled={off} />
            <Range label={t('gs.editor.offset')} value={lines.lineOffset} min={0} max={40} onChange={(v) => set({ lineOffset: v })} disabled={off} />
            <Toggle label={t('gs.editor.movementError')} checked={lines.bShowMovementError} onChange={(v) => set({ bShowMovementError: v })} />
            {lines.bShowMovementError && <Range label={t('gs.editor.multiplier')} value={lines.movementErrorScale} min={0} max={3} step={0.01} onChange={(v) => set({ movementErrorScale: v })} />}
            <Toggle label={t('gs.editor.firingError')} checked={lines.bShowShootingError} onChange={(v) => set({ bShowShootingError: v })} />
            {lines.bShowShootingError && <Range label={t('gs.editor.multiplier')} value={lines.firingErrorScale} min={0} max={3} step={0.01} onChange={(v) => set({ firingErrorScale: v })} />}
        </fieldset>
    )
}

const LayerEditor = ({ layer, onChange, primary }: { layer: Layer; onChange: (l: Layer) => void; primary: boolean }) => {
    const { t } = useTranslation()
    const set = (patch: Partial<Layer>) => onChange({ ...layer, ...patch })
    const color = layer.bUseCustomColor ? layer.colorCustom : layer.color
    return (
        <div className="flex flex-col gap-3">
            <fieldset className="flex flex-col gap-2 rounded-md border p-3">
                <legend className="px-1 text-xs font-semibold uppercase">{t('gs.editor.color')}</legend>
                <ColorField label={t('gs.editor.crosshairColor')} value={color} onChange={(c) => set(isPreset(c) ? { bUseCustomColor: false, color: c } : { bUseCustomColor: true, colorCustom: c })} />
                <Toggle label={t('gs.editor.outline')} checked={layer.bHasOutline} onChange={(v) => set({ bHasOutline: v })} />
                <Range label={t('gs.editor.outlineOpacity')} value={layer.outlineOpacity} min={0} max={1} step={0.01} onChange={(v) => set({ outlineOpacity: v })} disabled={!layer.bHasOutline} />
                <Range label={t('gs.editor.outlineThickness')} value={layer.outlineThickness} min={1} max={6} onChange={(v) => set({ outlineThickness: v })} disabled={!layer.bHasOutline} />
                <ColorField label={t('gs.editor.glow')} value={layer.outlineColor} onChange={(c) => set({ outlineColor: c, bHasOutline: true })} />
                <p className="text-xs text-muted-foreground">{t('gs.editor.glowHint')}</p>
            </fieldset>
            <fieldset className="flex flex-col gap-2 rounded-md border p-3">
                <legend className="px-1 text-xs font-semibold uppercase">{t('gs.editor.centerDot')}</legend>
                <Toggle label={t('gs.editor.showDot')} checked={layer.bDisplayCenterDot} onChange={(v) => set({ bDisplayCenterDot: v })} />
                <Range label={t('gs.editor.opacity')} value={layer.centerDotOpacity} min={0} max={1} step={0.01} onChange={(v) => set({ centerDotOpacity: v })} disabled={!layer.bDisplayCenterDot} />
                <Range label={t('gs.editor.thickness')} value={layer.centerDotSize} min={1} max={6} onChange={(v) => set({ centerDotSize: v })} disabled={!layer.bDisplayCenterDot} />
            </fieldset>
            {primary && (
                <fieldset className="flex flex-col gap-2 rounded-md border p-3">
                    <legend className="px-1 text-xs font-semibold uppercase">{t('gs.editor.general')}</legend>
                    <Toggle label={t('gs.editor.fade')} checked={layer.bFadeCrosshairWithFiringError} onChange={(v) => set({ bFadeCrosshairWithFiringError: v })} />
                    <Toggle label={t('gs.editor.spectated')} checked={layer.bShowSpectatedPlayerCrosshair} onChange={(v) => set({ bShowSpectatedPlayerCrosshair: v })} />
                </fieldset>
            )}
            <Toggle label={t('gs.editor.fixError')} checked={layer.bFixMinErrorAcrossWeapons} onChange={(v) => set({ bFixMinErrorAcrossWeapons: v })} />
            <LinesEditor title={t('gs.editor.inner')} lines={layer.innerLines} onChange={(l) => set({ innerLines: l })} />
            <LinesEditor title={t('gs.editor.outer')} lines={layer.outerLines} onChange={(l) => set({ outerLines: l })} />
        </div>
    )
}

type Props = { open: boolean; onOpenChange: (o: boolean) => void; initial: Profile; title: string; onSave: (p: Profile) => Promise<void> }

/** Full crosshair editor with a live preview; the code updates as you edit. */
export const CrosshairEditor = ({ open, onOpenChange, initial, title, onSave }: Props) => {
    const { t } = useTranslation()
    const [p, setP] = useState<Profile>(() => structuredClone(initial))
    const [busy, setBusy] = useState(false)
    const code = encodeCrosshair(p)
    const set = (patch: Partial<Profile>) => setP((cur) => ({ ...cur, ...patch }))
    const s = p.sniper
    const sniperColor = s.bUseCustomCenterDotColor ? s.centerDotColorCustom : s.centerDotColor

    const save = async () => {
        setBusy(true)
        try {
            await onSave({ ...p, profileName: p.profileName.trim() || initial.profileName })
            onOpenChange(false)
        } finally {
            setBusy(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-4xl">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                </DialogHeader>
                <div className="grid min-h-0 flex-1 gap-5 md:grid-cols-[14rem_1fr]">
                    <div className="flex flex-col gap-3">
                        <CrosshairPreview layer={p.primary} size={224} />
                        {!p.bUsePrimaryCrosshairForADS && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <CrosshairPreview layer={p.aDS} size={56} />
                                {t('gs.editor.ads')}
                            </div>
                        )}
                        <Input value={p.profileName} onChange={(e) => set({ profileName: e.target.value })} placeholder={t('gs.presets.name')} aria-label={t('gs.presets.name')} maxLength={40} />
                        <div className="flex items-center gap-1">
                            <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-[0.6875rem]" title={code}>
                                {code}
                            </code>
                            <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={t('gs.crosshair.copy')}
                                onClick={() => {
                                    void navigator.clipboard.writeText(code)
                                    toast.success(t('gs.crosshair.copied'))
                                }}
                            >
                                <Copy />
                            </Button>
                        </div>
                    </div>
                    <Tabs defaultValue="primary" className="min-h-0">
                        <TabsList>
                            <TabsTrigger value="primary">{t('gs.editor.primary')}</TabsTrigger>
                            <TabsTrigger value="ads">{t('gs.editor.ads')}</TabsTrigger>
                            <TabsTrigger value="sniper">{t('gs.editor.sniper')}</TabsTrigger>
                        </TabsList>
                        <div className="mt-3 max-h-[60vh] overflow-y-auto pr-2">
                            <TabsContent value="primary">
                                <LayerEditor layer={p.primary} primary onChange={(l) => set({ primary: l, ...(p.bUsePrimaryCrosshairForADS ? { aDS: structuredClone(l) } : {}) })} />
                            </TabsContent>
                            <TabsContent value="ads" className="flex flex-col gap-3">
                                <Toggle label={t('gs.editor.copyPrimary')} checked={p.bUsePrimaryCrosshairForADS} onChange={(v) => set({ bUsePrimaryCrosshairForADS: v, ...(v ? { aDS: structuredClone(p.primary) } : {}) })} />
                                {!p.bUsePrimaryCrosshairForADS && <LayerEditor layer={p.aDS} primary={false} onChange={(l) => set({ aDS: l })} />}
                            </TabsContent>
                            <TabsContent value="sniper" className="flex flex-col gap-2">
                                <Toggle label={t('gs.editor.showDot')} checked={s.bDisplayCenterDot} onChange={(v) => set({ sniper: { ...s, bDisplayCenterDot: v } })} />
                                <ColorField
                                    label={t('gs.editor.crosshairColor')}
                                    value={sniperColor}
                                    onChange={(c) => set({ sniper: { ...s, ...(isPreset(c) ? { bUseCustomCenterDotColor: false, centerDotColor: c } : { bUseCustomCenterDotColor: true, centerDotColorCustom: c }) } })}
                                />
                                <Range label={t('gs.editor.opacity')} value={s.centerDotOpacity} min={0} max={1} step={0.01} onChange={(v) => set({ sniper: { ...s, centerDotOpacity: v } })} />
                                <Range label={t('gs.editor.thickness')} value={s.centerDotSize} min={0} max={4} step={0.1} onChange={(v) => set({ sniper: { ...s, centerDotSize: v } })} />
                            </TabsContent>
                        </div>
                    </Tabs>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t('gs.delete.cancel')}
                    </Button>
                    <Button onClick={() => void save()} disabled={busy}>
                        {t('gs.editor.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
