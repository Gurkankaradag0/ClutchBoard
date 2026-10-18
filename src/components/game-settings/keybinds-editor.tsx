import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { humanize } from '@/components/game-settings/settings-editor'
import { useAgents, type AgentInfo } from '@/lib/assets'
import { GENERAL, agentProfiles, applyKeyOps, editKeybinds, useGsState, type AccountView, type Bind, type GsAccount, type GsClient, type KeyBind, type KeyOp } from '@/lib/game-settings'
import { invoke } from '@tauri-apps/api/core'
import { cn } from '@/lib/utils'

// Browser key codes -> Unreal key names (what the game stores). Letters and F-keys map 1:1.
const CODES: Record<string, string> = {
    Space: 'SpaceBar',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'BackSpace',
    CapsLock: 'CapsLock',
    ShiftLeft: 'LeftShift',
    ShiftRight: 'RightShift',
    ControlLeft: 'LeftControl',
    ControlRight: 'RightControl',
    AltLeft: 'LeftAlt',
    AltRight: 'RightAlt',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Insert: 'Insert',
    Delete: 'Delete',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Minus: 'Hyphen',
    Equal: 'Equals',
    BracketLeft: 'LeftBracket',
    BracketRight: 'RightBracket',
    Semicolon: 'Semicolon',
    Quote: 'Apostrophe',
    Backquote: 'Tilde',
    Backslash: 'Backslash',
    IntlBackslash: 'Backslash',
    Comma: 'Comma',
    Period: 'Period',
    Slash: 'Slash',
    NumpadAdd: 'Add',
    NumpadSubtract: 'Subtract',
    NumpadMultiply: 'Multiply',
    NumpadDivide: 'Divide',
    NumpadDecimal: 'Decimal',
    NumpadEnter: 'Enter'
}
const DIGITS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']
const MOUSE = ['LeftMouseButton', 'MiddleMouseButton', 'RightMouseButton', 'ThumbMouseButton', 'ThumbMouseButton2']

const ueKey = (code: string) => {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3)
    if (/^F\d{1,2}$/.test(code)) return code
    if (/^Digit\d$/.test(code)) return DIGITS[Number(code.slice(5))]
    if (/^Numpad\d$/.test(code)) return `NumPad${DIGITS[Number(code.slice(6))]}`
    return CODES[code]
}

const UNBOUND: Bind = { key: 'None', shift: false, ctrl: false, alt: false, cmd: false, tapHoldType: 'None' }

/** Click, then press a key, mouse button or scroll. Esc cancels. */
const KeyButton = ({ bind, onBind }: { bind: KeyBind | undefined; onBind: (key: string) => void }) => {
    const { t } = useTranslation()
    const [capturing, setCapturing] = useState(false)
    useEffect(() => {
        if (!capturing) return
        const done = (key: string | undefined) => {
            setCapturing(false)
            if (key) onBind(key)
        }
        const onKey = (e: KeyboardEvent) => {
            e.preventDefault()
            e.stopPropagation()
            if (e.code === 'Escape') return done(undefined)
            const k = ueKey(e.code)
            if (k) done(k)
        }
        const onMouse = (e: MouseEvent) => {
            e.preventDefault()
            done(MOUSE[e.button])
        }
        const onWheel = (e: WheelEvent) => {
            e.preventDefault()
            done(e.deltaY < 0 ? 'MouseScrollUp' : 'MouseScrollDown')
        }
        // Next tick, so the click that started capturing isn't taken as the binding.
        const id = setTimeout(() => {
            window.addEventListener('keydown', onKey, true)
            window.addEventListener('mousedown', onMouse, true)
            window.addEventListener('wheel', onWheel, { capture: true, passive: false })
        })
        return () => {
            clearTimeout(id)
            window.removeEventListener('keydown', onKey, true)
            window.removeEventListener('mousedown', onMouse, true)
            window.removeEventListener('wheel', onWheel, true)
        }
    }, [capturing, onBind])

    const key = bind?.key && bind.key !== 'None' ? bind.key : null
    return (
        <button
            type="button"
            onClick={() => setCapturing(true)}
            onContextMenu={(e) => capturing && e.preventDefault()}
            className={cn('h-7 min-w-28 rounded-md border px-2 text-xs font-medium transition-colors hover:bg-accent', capturing && 'animate-pulse border-primary bg-primary/10 text-primary', !key && !capturing && 'text-muted-foreground')}
        >
            {capturing ? t('gs.keybinds.press') : key ? humanize(key) : '—'}
        </button>
    )
}

const agentLabel = (agents: AgentInfo[] | undefined, name: string) => agents?.find((a) => a.developerName === name || a.displayName === name)

export const KeybindsEditor = ({ view, account, client }: { view: AccountView; account: GsAccount; client: GsClient | null | undefined }) => {
    const { t } = useTranslation()
    const qc = useQueryClient()
    const { data: agents } = useAgents()
    const { data: state } = useGsState()
    const [profile, setProfile] = useState(GENERAL)
    const [adding, setAdding] = useState(false)
    const [removing, setRemoving] = useState<string | null>(null)
    const [custom, setCustom] = useState('')

    // Show queued changes as if applied.
    const pending = (state?.pending[account.puuid] ?? []).flatMap((j) => j.keyOps ?? [])
    const blob = useMemo(() => {
        const b = structuredClone(view.blob)
        if (pending.length) applyKeyOps(b, pending)
        return b
    }, [view.blob, pending])
    const profiles = agentProfiles(blob)
    const current = profile === GENERAL || profiles.includes(profile) ? profile : GENERAL

    // Every action seen in any account's cloud copy, so unchanged ones can be bound too.
    const catalog = useQuery({
        queryKey: ['gs', 'actions'],
        staleTime: 5 * 60_000,
        queryFn: async () => {
            const names = new Set<string>()
            for (const a of await invoke<{ puuid: string }[]>('gs_accounts')) {
                const snap = await invoke<{ settings: { actionMappings?: KeyBind[] } } | null>('gs_load', { name: `snap-${a.puuid}` })
                for (const m of snap?.settings.actionMappings ?? []) names.add(m.name)
            }
            return [...names]
        }
    })

    const maps = (blob.actionMappings ?? []).filter((m) => (m.characterName ?? GENERAL) === current)
    const actions = [...new Set(maps.map((m) => m.name))].sort()
    const addable = (catalog.data ?? []).filter((a) => !actions.includes(a)).sort()

    const run = async (ops: KeyOp[]) => {
        try {
            const r = await editKeybinds(qc, account, client, ops, t('gs.keybinds.pendingLabel'))
            toast.success(r === 'pending' ? t('gs.settings.savedPending') : t('gs.settings.saved'), { id: 'gs-keys', description: r === 'applied' && client?.gameRunning ? t('gs.apply.gameRunning') : undefined })
        } catch (e) {
            toast.error(t('gs.apply.failed', { message: String(e) }))
        }
    }
    const set = (action: string, index: number, key: string) => void run([{ kind: 'set', character: current, action, index, bind: { ...UNBOUND, key } }])

    if (!view.hasKeybinds && !pending.length) return <p className="py-6 text-sm text-muted-foreground">{t('gs.keybinds.none')}</p>

    const usedAgents = new Set(profiles)
    const freeAgents = (agents ?? []).filter((a) => !usedAgents.has(a.developerName) && !usedAgents.has(a.displayName)).sort((a, b) => a.displayName.localeCompare(b.displayName))

    return (
        <div className="flex flex-col gap-3">
            {client?.puuid !== account.puuid && <p className="text-xs text-muted-foreground">{t('gs.keybinds.offlineHint')}</p>}
            <div className="flex flex-wrap items-center gap-1.5">
                {[GENERAL, ...profiles].map((p) => {
                    const agent = agentLabel(agents, p)
                    return (
                        <span key={p} className={cn('flex items-center rounded-md border text-sm', p === current ? 'border-primary/60 bg-primary/8' : 'hover:bg-accent')}>
                            <button type="button" onClick={() => setProfile(p)} className="flex items-center gap-1.5 px-2.5 py-1">
                                {agent && <img src={agent.displayIcon} alt="" className="size-5 rounded-sm" />}
                                {p === GENERAL ? t('gs.keybinds.general') : (agent?.displayName ?? p)}
                            </button>
                            {p !== GENERAL && (
                                <button type="button" onClick={() => setRemoving(p)} className="px-1.5 text-muted-foreground hover:text-loss" aria-label={t('gs.keybinds.removeProfile')} title={t('gs.keybinds.removeProfile')}>
                                    <X className="size-3.5" />
                                </button>
                            )}
                        </span>
                    )
                })}
                <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
                    <Plus />
                    {t('gs.keybinds.addProfile')}
                </Button>
            </div>

            <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground uppercase">
                    <tr>
                        <th className="py-2 font-medium">{t('gs.keybinds.action')}</th>
                        <th className="py-2 font-medium">{t('gs.keybinds.primary')}</th>
                        <th className="py-2 font-medium">{t('gs.keybinds.secondary')}</th>
                        <th />
                    </tr>
                </thead>
                <tbody className="divide-y">
                    {actions.map((action) => (
                        <tr key={action}>
                            <td className="py-1.5 pr-4 text-muted-foreground" title={action}>
                                {humanize(action)}
                            </td>
                            {[0, 1].map((i) => {
                                const b = maps.find((m) => m.name === action && (m.bindIndex ?? 0) === i)
                                return (
                                    <td key={i} className="py-1.5 pr-2">
                                        <span className="flex items-center gap-1">
                                            <KeyButton bind={b} onBind={(key) => set(action, i, key)} />
                                            {b && b.key !== 'None' && (
                                                <button type="button" className="text-muted-foreground hover:text-loss" onClick={() => set(action, i, 'None')} aria-label={t('gs.keybinds.unbind')} title={t('gs.keybinds.unbind')}>
                                                    <X className="size-3.5" />
                                                </button>
                                            )}
                                        </span>
                                    </td>
                                )
                            })}
                            <td className="py-1.5 text-right">
                                <Button size="icon-sm" variant="ghost" className="text-muted-foreground" onClick={() => void run([{ kind: 'reset', character: current, action }])} aria-label={t('gs.settings.reset')} title={t('gs.settings.reset')}>
                                    <RotateCcw />
                                </Button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <div className="flex flex-wrap items-center gap-2">
                {addable.length > 0 && (
                    <Select value="" onValueChange={(a) => set(a, 0, 'None')}>
                        <SelectTrigger size="sm" className="w-64">
                            <SelectValue placeholder={t('gs.keybinds.addAction', { count: addable.length })} />
                        </SelectTrigger>
                        <SelectContent>
                            {addable.map((a) => (
                                <SelectItem key={a} value={a}>
                                    {humanize(a)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
                <form
                    className="flex items-center gap-1"
                    onSubmit={(e) => {
                        e.preventDefault()
                        if (custom.trim()) set(custom.trim(), 0, 'None')
                        setCustom('')
                    }}
                >
                    <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={t('gs.keybinds.customAction')} className="h-8 w-56 font-mono text-xs" spellCheck={false} />
                    <Button type="submit" size="sm" variant="ghost" disabled={!custom.trim()}>
                        <Plus />
                    </Button>
                </form>
            </div>
            <p className="text-xs text-muted-foreground">{t('gs.keybinds.catalogHint')}</p>

            {adding && (
                <Dialog open onOpenChange={setAdding}>
                    <DialogContent className="sm:max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>{t('gs.keybinds.addProfile')}</DialogTitle>
                            <DialogDescription>{t('gs.keybinds.addProfileHint')}</DialogDescription>
                        </DialogHeader>
                        <ul className="grid max-h-96 grid-cols-3 gap-1.5 overflow-y-auto sm:grid-cols-4">
                            {freeAgents.map((a) => (
                                <li key={a.uuid}>
                                    <button
                                        type="button"
                                        className="flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-sm hover:bg-accent"
                                        onClick={() => {
                                            setAdding(false)
                                            setProfile(a.developerName)
                                            void run([{ kind: 'addProfile', character: a.developerName }])
                                        }}
                                    >
                                        <img src={a.displayIcon} alt="" className="size-6 rounded-sm" />
                                        {a.displayName}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </DialogContent>
                </Dialog>
            )}
            {removing && (
                <Dialog open onOpenChange={(o) => !o && setRemoving(null)}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{t('gs.keybinds.removeTitle', { name: agentLabel(agents, removing)?.displayName ?? removing })}</DialogTitle>
                            <DialogDescription>{t('gs.keybinds.removeBody')}</DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setRemoving(null)}>
                                {t('gs.delete.cancel')}
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={() => {
                                    void run([{ kind: 'removeProfile', character: removing }])
                                    setRemoving(null)
                                    setProfile(GENERAL)
                                }}
                            >
                                {t('gs.keybinds.removeProfile')}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    )
}
