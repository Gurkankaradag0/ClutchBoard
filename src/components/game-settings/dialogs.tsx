import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { applyTo, type ApplyResult, type Category, type GsAccount, type GsClient, type PresetData } from '@/lib/game-settings'
import { cn } from '@/lib/utils'

const Check = ({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; disabled?: boolean }) => (
    <label className={cn('flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-checked:border-primary/60 has-checked:bg-primary/8', disabled && 'cursor-not-allowed opacity-50')}>
        <input type="checkbox" className="size-4 accent-primary" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        {children}
    </label>
)

export const CategoryPicker = ({ available, value, onChange }: { available: Category[]; value: Category[]; onChange: (v: Category[]) => void }) => {
    const { t } = useTranslation()
    return (
        <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <legend className="mb-2 text-xs font-semibold text-muted-foreground uppercase">{t('gs.apply.categories')}</legend>
            {available.map((c) => (
                <Check key={c} checked={value.includes(c)} onChange={(on) => onChange(on ? [...value, c] : value.filter((x) => x !== c))}>
                    {t(`gs.categories.${c}`)}
                </Check>
            ))}
        </fieldset>
    )
}

type NameDialogProps = { open: boolean; onOpenChange: (o: boolean) => void; title: string; available: Category[]; defaultName?: string; action: string; onSubmit: (name: string, cats: Category[]) => Promise<void> | void }

/** Name + categories: used for "save as preset" and "export". */
export const NameDialog = ({ open, onOpenChange, title, available, defaultName = '', action, onSubmit }: NameDialogProps) => {
    const { t } = useTranslation()
    const [name, setName] = useState(defaultName)
    const [cats, setCats] = useState<Category[]>(available)
    const [busy, setBusy] = useState(false)
    const submit = async (e: React.FormEvent) => {
        e.preventDefault()
        setBusy(true)
        try {
            await onSubmit(name.trim() || defaultName, cats)
            onOpenChange(false)
        } finally {
            setBusy(false)
        }
    }
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
                    <DialogHeader>
                        <DialogTitle>{title}</DialogTitle>
                    </DialogHeader>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('gs.presets.name')} aria-label={t('gs.presets.name')} maxLength={60} />
                    <CategoryPicker available={available} value={cats} onChange={setCats} />
                    <DialogFooter>
                        <Button type="submit" disabled={busy || !cats.length}>
                            {action}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

type ApplyProps = {
    open: boolean
    onOpenChange: (o: boolean) => void
    label: string
    data: PresetData
    available: Category[]
    accounts: GsAccount[]
    names: Record<string, string>
    client: GsClient | null | undefined
    /** Source account, left out of the targets. */
    exclude?: string
}

/** Applies a preset (or another account's settings) to the chosen accounts. */
export const ApplyDialog = ({ open, onOpenChange, label, data, available, accounts, names, client, exclude }: ApplyProps) => {
    const { t } = useTranslation()
    const qc = useQueryClient()
    const [cats, setCats] = useState<Category[]>(available)
    const [targets, setTargets] = useState<string[]>([])
    const [busy, setBusy] = useState(false)
    const list = accounts.filter((a) => a.puuid !== exclude)

    const run = async () => {
        setBusy(true)
        const results: ApplyResult[] = []
        try {
            for (const a of list.filter((x) => targets.includes(x.puuid))) results.push(await applyTo(qc, a, client, data, cats, label, t('gs.crosshair.defaultName')))
        } catch (e) {
            toast.error(t('gs.apply.failed', { message: String(e) }))
        } finally {
            setBusy(false)
        }
        if (!results.length) return
        const pending = results.filter((r) => r.cloud === 'pending').length
        const notes = [
            pending && t('gs.apply.pendingInfo', { count: pending }),
            results.some((r) => r.crosshair === 'full') && t('gs.apply.crosshairFull'),
            results.some((r) => r.local === 'blocked') && t('gs.apply.localBlocked'),
            results.some((r) => r.cloud === 'applied') && client?.gameRunning && t('gs.apply.gameRunning')
        ].filter(Boolean)
        toast.success(t('gs.apply.done', { count: results.length }), { description: notes.join(' · ') || undefined })
        onOpenChange(false)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{t('gs.apply.title', { name: label })}</DialogTitle>
                    <DialogDescription>{t('gs.apply.note')}</DialogDescription>
                </DialogHeader>
                <CategoryPicker available={available} value={cats} onChange={setCats} />
                <fieldset className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
                    <legend className="mb-2 flex w-full items-center justify-between text-xs font-semibold text-muted-foreground uppercase">
                        {t('gs.apply.targets')}
                        <button type="button" className="text-primary normal-case hover:underline" onClick={() => setTargets(targets.length === list.length ? [] : list.map((a) => a.puuid))}>
                            {targets.length === list.length ? t('gs.apply.none') : t('gs.apply.all')}
                        </button>
                    </legend>
                    {list.map((a) => (
                        <Check key={a.puuid} checked={targets.includes(a.puuid)} onChange={(on) => setTargets(on ? [...targets, a.puuid] : targets.filter((x) => x !== a.puuid))}>
                            <span className="min-w-0 flex-1 truncate">{names[a.puuid] ?? `${t('gs.unknown')} · ${a.puuid.slice(0, 8)}`}</span>
                            {client?.puuid === a.puuid && <span className="text-xs text-win">{t('gs.badge.signedIn')}</span>}
                        </Check>
                    ))}
                </fieldset>
                <DialogFooter>
                    <Button onClick={() => void run()} disabled={busy || !cats.length || !targets.length}>
                        {t('gs.apply.run', { count: targets.length })}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
