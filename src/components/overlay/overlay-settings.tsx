import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Eye, TriangleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { parseGus, type GsAccount, type GsClient } from '@/lib/game-settings'
import { cn } from '@/lib/utils'
import type { OverlayConfig } from '@/overlay'

const PANELS = [
    { id: 'live', title: 'nav.live' },
    { id: 'friends', title: 'chat.friends' }
] as const

const MODIFIERS = new Set(['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'])

/** "ctrl+shift+KeyL" -> "Ctrl + Shift + L" */
export const hotkeyLabel = (hotkey: string) =>
    hotkey
        .split('+')
        .map((k) => ({ ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' })[k] ?? k.replace(/^Key|^Digit/, ''))
        .join(' + ')

/** Click, then press a combination with Ctrl or Alt. Esc cancels. */
const HotkeyField = ({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) => {
    const { t } = useTranslation()
    const [capturing, setCapturing] = useState(false)
    useEffect(() => {
        if (!capturing) return
        const onKey = (e: KeyboardEvent) => {
            e.preventDefault()
            if (e.code === 'Escape') return setCapturing(false)
            if (MODIFIERS.has(e.code)) return
            if (!e.ctrlKey && !e.altKey) return void toast.error(t('overlay.needsModifier'))
            setCapturing(false)
            onChange([e.ctrlKey && 'ctrl', e.altKey && 'alt', e.shiftKey && 'shift', e.code].filter(Boolean).join('+'))
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
    }, [capturing, onChange, t])
    return (
        <span className="flex items-center gap-1">
            <button type="button" onClick={() => setCapturing(true)} className={cn('h-8 min-w-40 rounded-md border px-3 text-sm font-medium hover:bg-accent', capturing && 'animate-pulse border-primary bg-primary/10 text-primary', !value && !capturing && 'text-muted-foreground')}>
                {capturing ? t('overlay.press') : value ? hotkeyLabel(value) : t('overlay.none')}
            </button>
            {value && (
                <Button size="icon-sm" variant="ghost" className="text-muted-foreground" onClick={() => onChange(null)} aria-label={t('overlay.clear')} title={t('overlay.clear')}>
                    <X />
                </Button>
            )}
        </span>
    )
}

/** Exclusive fullscreen (UE window mode 0) can't be drawn over; 1 = windowed fullscreen. */
const useFullscreenWarning = () =>
    useQuery({
        queryKey: ['overlay', 'windowMode'],
        staleTime: 30_000,
        queryFn: async () => {
            const client = await invoke<GsClient | null>('gs_client')
            if (!client) return false
            const account = (await invoke<GsAccount[]>('gs_accounts')).find((a) => a.puuid === client.puuid)
            if (!account) return false
            const files = await invoke<{ gus: string | null }>('gs_local_read', { dir: account.dir })
            // The confirmed mode is what the game runs in; key casing varies between writes.
            const values = new Map(Object.values(files.gus ? parseGus(files.gus) : {}).flatMap((sec) => Object.entries(sec).map(([k, v]) => [k.toLowerCase(), v])))
            return (values.get('lastconfirmedfullscreenmode') ?? values.get('fullscreenmode')) === '0'
        }
    })

export const OverlaySettings = () => {
    const { t } = useTranslation()
    const qc = useQueryClient()
    const config = useQuery({ queryKey: ['overlay', 'config'], queryFn: () => invoke<OverlayConfig>('overlay_config') })
    const fullscreen = useFullscreenWarning()
    const refresh = () => void qc.invalidateQueries({ queryKey: ['overlay', 'config'] })

    const setHotkey = useMutation({
        mutationFn: ({ target, hotkey }: { target: string; hotkey: string | null }) => invoke<void>('overlay_set_hotkey', { target, hotkey }),
        onSuccess: refresh,
        onError: (e) => {
            toast.error(String(e).includes('in use') ? t('overlay.inUse') : String(e))
            refresh()
        }
    })
    const c = config.data

    return (
        <div className="flex flex-col gap-6 py-6">
            <p className="max-w-2xl text-sm text-muted-foreground">{t('overlay.intro')}</p>
            {fullscreen.data && (
                <p className="flex max-w-2xl items-start gap-2 rounded-md border border-gold/40 bg-gold/5 p-3 text-sm">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden />
                    {t('overlay.fullscreen')}
                </p>
            )}

            <section className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold uppercase">{t('overlay.panels')}</h2>
                <ul className="divide-y rounded-md border">
                    {PANELS.map((p) => {
                        const panel = c?.panels[p.id]
                        return (
                            <li key={p.id} className="flex flex-wrap items-center gap-4 px-4 py-3">
                                <span className="w-32 font-medium">{t(p.title)}</span>
                                <HotkeyField value={panel?.hotkey ?? null} onChange={(hotkey) => setHotkey.mutate({ target: p.id, hotkey })} />
                                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                                    {t('overlay.opacity')}
                                    <input type="range" className="w-28 accent-primary" min={0.2} max={1} step={0.05} value={panel?.opacity ?? 0.85} onChange={(e) => void invoke('overlay_set_opacity', { id: p.id, opacity: Number(e.target.value) }).then(refresh)} />
                                    <span className="w-9 text-right tabular-nums">{Math.round((panel?.opacity ?? 0.85) * 100)}%</span>
                                </label>
                                <Button size="sm" variant="outline" className="ml-auto" onClick={() => void invoke('overlay_toggle', { id: p.id })}>
                                    <Eye />
                                    {t('overlay.toggle')}
                                </Button>
                            </li>
                        )
                    })}
                </ul>
            </section>
            <p className="max-w-2xl text-xs text-muted-foreground">{t('overlay.safety')}</p>
        </div>
    )
}
