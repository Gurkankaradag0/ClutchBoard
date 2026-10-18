import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Copy, Download, History, Loader2, MoreVertical, Plus, RefreshCw, Save, Send, SlidersHorizontal, Star, Trash2, Upload, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CrosshairEditor } from '@/components/game-settings/crosshair-editor'
import { CrosshairPreview } from '@/components/game-settings/crosshair-preview'
import { KeybindsEditor } from '@/components/game-settings/keybinds-editor'
import { SettingsEditor } from '@/components/game-settings/settings-editor'
import { ApplyDialog, CategoryPicker, NameDialog } from '@/components/game-settings/dialogs'
import { fetchAccountByPuuid, isApiError } from '@/lib/api'
import { decodeCrosshair, defaultProfile, encodeCrosshair, type Profile } from '@/lib/crosshair'
import {
    CATEGORIES,
    PROFILE_KEY,
    applyTo,
    captureCloud,
    deleteAccount,
    editCrosshairs,
    exportJson,
    importJson,
    loadBackups,
    pick,
    presentCategories,
    profileMatch,
    readProfiles,
    restoreBackup,
    saveExport,
    updateState,
    useAccountView,
    useGsAccounts,
    useGsClient,
    useGsState,
    type AccountView,
    type Category,
    type CrosshairOp,
    type GsAccount,
    type GsClient,
    type GsState,
    type Preset,
    type PresetData
} from '@/lib/game-settings'
import { timeAgo } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useSeen } from '@/stores/players'
import { useRecent } from '@/stores/recent'

/** puuid -> "Name#TAG" from everything known locally. */
const useNames = (state: GsState | undefined) => {
    const recent = useRecent((s) => s.entries)
    const seen = useSeen((s) => s.players)
    return useMemo(() => {
        const out: Record<string, string> = {}
        for (const p of Object.values(seen)) out[p.puuid] = `${p.name}#${p.tag}`
        for (const e of recent) out[e.puuid] = `${e.name}#${e.tag}`
        for (const [puuid, n] of Object.entries(state?.names ?? {})) out[puuid] = `${n.name}#${n.tag}`
        return out
    }, [recent, seen, state?.names])
}

const download = async (t: (k: string, o?: Record<string, unknown>) => string, p: Preset) => {
    const file = `ClutchBoard-${p.name}.json`
    try {
        const path = await saveExport(file, exportJson(p))
        toast.success(t('gs.export.saved', { path }))
    } catch (e) {
        toast.error(String(e))
    }
}

const newPreset = (name: string, cats: Category[], data: PresetData, source?: Preset['source']): Preset => ({ id: crypto.randomUUID(), name, createdAt: Date.now(), source, categories: cats, data })

// ---- Presets ----

const PresetsSection = ({ state, accounts, names, client }: { state: GsState; accounts: GsAccount[]; names: Record<string, string>; client: GsClient | null | undefined }) => {
    const { t } = useTranslation()
    const qc = useQueryClient()
    const file = useRef<HTMLInputElement>(null)
    const [applying, setApplying] = useState<Preset | null>(null)
    const def = state.presets.find((p) => p.id === state.defaultId)

    const onImport = async (f: File | undefined) => {
        if (!f) return
        try {
            const p = importJson(await f.text())
            await updateState(qc, (s) => ({ ...s, presets: [...s.presets, p] }))
            toast.success(t('gs.presets.imported'))
        } catch (e) {
            toast.error(t('gs.presets.importFailed', { message: e instanceof Error ? e.message : String(e) }))
        }
    }

    return (
        <section className="rounded-md border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center gap-3">
                <h2 className="font-display text-lg font-bold uppercase">{t('gs.presets.title')}</h2>
                <Button size="sm" variant="outline" className="ml-auto" onClick={() => file.current?.click()}>
                    <Upload />
                    {t('gs.presets.import')}
                </Button>
                <input ref={file} type="file" accept=".json,application/json" className="hidden" onChange={(e) => void onImport(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
            </div>
            {state.presets.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('gs.presets.none')}</p>
            ) : (
                <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {state.presets.map((p) => {
                        const isDef = p.id === state.defaultId
                        return (
                            <li key={p.id} className={cn('flex flex-col gap-2 rounded-md border p-3', isDef && 'border-gold/50 bg-gold/5')}>
                                <div className="flex items-start gap-2">
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate font-medium">{p.name}</p>
                                        <p className="truncate text-xs text-muted-foreground">
                                            {p.source?.name ? t('gs.presets.from', { name: p.source.name }) : ''} {timeAgo(p.createdAt)}
                                        </p>
                                    </div>
                                    <Button size="icon-sm" variant="ghost" aria-pressed={isDef} aria-label={t('gs.presets.makeDefault')} title={t('gs.presets.makeDefault')} onClick={() => void updateState(qc, (s) => ({ ...s, defaultId: isDef ? undefined : p.id }))}>
                                        <Star className={cn(isDef && 'fill-gold text-gold')} />
                                    </Button>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                    {p.categories.map((c) => (
                                        <Badge key={c} variant="secondary">
                                            {t(`gs.categories.${c}`)}
                                        </Badge>
                                    ))}
                                </div>
                                <div className="mt-auto flex gap-1">
                                    <Button size="sm" onClick={() => setApplying(p)}>
                                        <Send />
                                        {t('gs.presets.apply')}
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => void download(t, p)}>
                                        <Download />
                                        {t('gs.presets.export')}
                                    </Button>
                                    <Button
                                        size="icon-sm"
                                        variant="ghost"
                                        className="ml-auto text-muted-foreground hover:text-loss"
                                        aria-label={t('gs.presets.delete')}
                                        title={t('gs.presets.delete')}
                                        onClick={() => void updateState(qc, (s) => ({ ...s, presets: s.presets.filter((x) => x.id !== p.id), defaultId: s.defaultId === p.id ? undefined : s.defaultId }))}
                                    >
                                        <Trash2 />
                                    </Button>
                                </div>
                            </li>
                        )
                    })}
                </ul>
            )}

            <div className="mt-4 flex flex-col gap-3 border-t pt-4">
                <label className={cn('flex items-start gap-2 text-sm', !def && 'opacity-60')}>
                    <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={state.auto.enabled} disabled={!def} onChange={(e) => void updateState(qc, (s) => ({ ...s, auto: { ...s.auto, enabled: e.target.checked } }))} />
                    <span>
                        <span className="font-medium">{t('gs.auto.label')}</span>
                        <span className="block text-xs text-muted-foreground">{def ? t('gs.auto.hint', { name: def.name }) : t('gs.auto.noDefault')}</span>
                    </span>
                </label>
                {def && state.auto.enabled && (
                    <CategoryPicker
                        available={def.categories}
                        value={state.auto.categories.filter((c) => def.categories.includes(c))}
                        onChange={(v) => void updateState(qc, (s) => ({ ...s, auto: { ...s.auto, categories: [...v, ...s.auto.categories.filter((c) => !def.categories.includes(c))] } }))}
                    />
                )}
            </div>

            {applying && <ApplyDialog open onOpenChange={(o) => !o && setApplying(null)} label={applying.name} data={applying.data} available={applying.categories} accounts={accounts} names={names} client={client} />}
        </section>
    )
}

// ---- Account detail tabs ----

const RenameDialog = ({ profile, onClose, onSave }: { profile: Profile; onClose: () => void; onSave: (name: string) => Promise<void> }) => {
    const { t } = useTranslation()
    const [name, setName] = useState(profile.profileName)
    const [busy, setBusy] = useState(false)
    return (
        <Dialog open onOpenChange={(o) => !o && onClose()}>
            <DialogContent>
                <form
                    className="flex flex-col gap-4"
                    onSubmit={(e) => {
                        e.preventDefault()
                        if (!name.trim()) return
                        setBusy(true)
                        void onSave(name.trim()).finally(() => {
                            setBusy(false)
                            onClose()
                        })
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>{t('gs.crosshair.rename')}</DialogTitle>
                    </DialogHeader>
                    <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus aria-label={t('gs.presets.name')} />
                    <DialogFooter>
                        <Button type="submit" disabled={busy || !name.trim()}>
                            {t('gs.editor.save')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

const CrosshairTab = ({ view, account, client }: { view: AccountView; account: GsAccount; client: GsClient | null | undefined }) => {
    const { t } = useTranslation()
    const qc = useQueryClient()
    const [code, setCode] = useState('')
    const [editor, setEditor] = useState<{ profile: Profile; original?: Profile } | null>(null)
    const [renaming, setRenaming] = useState<Profile | null>(null)
    const [deleting, setDeleting] = useState<Profile | null>(null)
    const data = readProfiles(view.blob)
    const parsed = code.trim() ? decodeCrosshair(code, t('gs.crosshair.importedName')) : null
    const label = (name: string) => `${t('gs.categories.crosshair')}: ${name}`

    const addProfile = async (profile: Profile) => {
        try {
            const r = await applyTo(qc, account, client, { blob: { stringSettings: [{ settingEnum: PROFILE_KEY, value: JSON.stringify({ currentProfile: 0, profiles: [profile] }) }] } }, ['crosshair'], label(profile.profileName), t('gs.crosshair.defaultName'))
            if (r.crosshair === 'full') toast.error(t('gs.apply.crosshairFull'))
            else toast.success(r.cloud === 'pending' ? t('gs.crosshair.addedPending') : r.crosshair === 'exists' ? t('gs.crosshair.exists') : t('gs.crosshair.added'))
        } catch (e) {
            toast.error(t('gs.apply.failed', { message: String(e) }))
        }
    }

    const run = async (ops: CrosshairOp[], name: string, done: string) => {
        try {
            const r = await editCrosshairs(qc, account, client, ops, label(name))
            toast.success(r === 'pending' ? t('gs.crosshair.editPending') : done)
        } catch (e) {
            toast.error(String(e).includes('crosshair profile not found') ? t('gs.crosshair.opMissing', { label: name }) : t('gs.apply.failed', { message: String(e) }))
        }
    }

    const copy = (c: string) => {
        void navigator.clipboard.writeText(c)
        toast.success(t('gs.crosshair.copied'))
    }

    return (
        <div className="flex flex-col gap-4">
            <form
                className="flex flex-col gap-2 rounded-md border bg-card p-3"
                onSubmit={(e) => {
                    e.preventDefault()
                    if (parsed) void addProfile(parsed).then(() => setCode(''))
                }}
            >
                <div className="flex items-center justify-between gap-2">
                    <label htmlFor="xhair-code" className="text-sm font-medium">
                        {t('gs.crosshair.addCode')}
                    </label>
                    <Button type="button" size="sm" variant="outline" onClick={() => setEditor({ profile: defaultProfile(t('gs.crosshair.importedName')) })}>
                        <Plus />
                        {t('gs.crosshair.create')}
                    </Button>
                </div>
                <div className="flex items-center gap-3">
                    {parsed ? <CrosshairPreview layer={parsed.primary} size={44} /> : <div className="size-11 shrink-0 rounded-md border border-dashed" />}
                    <Input id="xhair-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="0;P;c;5;h;0;0l;4;0o;2;0a;1;0f;0;1b;0" className="font-mono" spellCheck={false} aria-invalid={!!code.trim() && !parsed} />
                    <Button type="button" variant="outline" disabled={!parsed} onClick={() => parsed && setEditor({ profile: parsed })}>
                        <SlidersHorizontal />
                        {t('gs.crosshair.edit')}
                    </Button>
                    <Button type="submit" disabled={!parsed}>
                        <Plus />
                        {t('gs.crosshair.add')}
                    </Button>
                </div>
                <p className={cn('text-xs', code.trim() && !parsed ? 'text-loss' : 'text-muted-foreground')}>{code.trim() && !parsed ? t('gs.crosshair.invalid') : t('gs.crosshair.addHint')}</p>
            </form>

            {!data ? (
                <p className="text-sm text-muted-foreground">{t('gs.crosshair.none')}</p>
            ) : (
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {data.profiles.map((p, i) => {
                        const c = encodeCrosshair(p)
                        const current = i === data.currentProfile
                        return (
                            <li key={i} className={cn('flex items-center gap-3 rounded-md border p-2', current && 'border-primary/60 bg-primary/5')}>
                                <button type="button" onClick={() => setEditor({ profile: p, original: p })} aria-label={t('gs.crosshair.edit')} className="shrink-0 rounded-md transition-opacity hover:opacity-80">
                                    <CrosshairPreview layer={p.primary} size={64} />
                                </button>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium" title={p.profileName}>
                                        {p.profileName || '—'}
                                    </p>
                                    {current && <p className="text-[0.6875rem] font-semibold text-primary uppercase">{t('gs.crosshair.current')}</p>}
                                    <p className="truncate font-mono text-[0.6875rem] text-muted-foreground" title={c}>
                                        {c}
                                    </p>
                                </div>
                                <Button size="icon-sm" variant="ghost" onClick={() => copy(c)} aria-label={t('gs.crosshair.copy')} title={t('gs.crosshair.copy')}>
                                    <Copy />
                                </Button>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button size="icon-sm" variant="ghost" aria-label={t('gs.crosshair.more')}>
                                            <MoreVertical />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        {!current && <DropdownMenuItem onSelect={() => void run([{ kind: 'select', match: profileMatch(p) }], p.profileName, t('gs.crosshair.selected'))}>{t('gs.crosshair.use')}</DropdownMenuItem>}
                                        <DropdownMenuItem onSelect={() => setEditor({ profile: p, original: p })}>{t('gs.crosshair.edit')}</DropdownMenuItem>
                                        <DropdownMenuItem onSelect={() => setRenaming(p)}>{t('gs.crosshair.rename')}</DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem variant="destructive" disabled={data.profiles.length <= 1} onSelect={() => setDeleting(p)}>
                                            {t('gs.crosshair.delete')}
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </li>
                        )
                    })}
                </ul>
            )}

            {editor && (
                <CrosshairEditor
                    open
                    onOpenChange={(o) => !o && setEditor(null)}
                    initial={editor.profile}
                    title={editor.original ? t('gs.editor.editTitle', { name: editor.original.profileName }) : t('gs.editor.newTitle')}
                    onSave={(p) => (editor.original ? run([{ kind: 'update', match: profileMatch(editor.original), profile: p }], p.profileName, t('gs.crosshair.saved')) : addProfile(p))}
                />
            )}
            {renaming && <RenameDialog profile={renaming} onClose={() => setRenaming(null)} onSave={(name) => run([{ kind: 'update', match: profileMatch(renaming), profile: { ...renaming, profileName: name } }], name, t('gs.crosshair.saved'))} />}
            {deleting && (
                <Dialog open onOpenChange={(o) => !o && setDeleting(null)}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{t('gs.crosshair.deleteTitle', { name: deleting.profileName })}</DialogTitle>
                            <DialogDescription>{t('gs.crosshair.deleteBody')}</DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setDeleting(null)}>
                                {t('gs.delete.cancel')}
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={() => {
                                    void run([{ kind: 'delete', match: profileMatch(deleting) }], deleting.profileName, t('gs.crosshair.deleted'))
                                    setDeleting(null)
                                }}
                            >
                                <Trash2 />
                                {t('gs.crosshair.delete')}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    )
}

// ---- Account detail ----

const DeleteDialog = ({ account, name, gameRunning, onClose }: { account: GsAccount; name: string | undefined; gameRunning: boolean; onClose: () => void }) => {
    const { t } = useTranslation()
    const qc = useQueryClient()
    const del = useMutation({
        mutationFn: () => deleteAccount(qc, account),
        onSuccess: () => {
            toast.success(t('gs.delete.done'))
            onClose()
        },
        onError: (e) => toast.error(String(e).includes('game running') ? t('gs.delete.gameRunning') : t('gs.apply.failed', { message: String(e) }))
    })
    return (
        <Dialog open onOpenChange={(o) => !o && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('gs.delete.title', { name: name ?? account.puuid.slice(0, 8) })}</DialogTitle>
                    <DialogDescription>{t('gs.delete.body')}</DialogDescription>
                </DialogHeader>
                {gameRunning && <p className="text-sm text-loss">{t('gs.delete.gameRunning')}</p>}
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        {t('gs.delete.cancel')}
                    </Button>
                    <Button variant="destructive" onClick={() => del.mutate()} disabled={gameRunning || del.isPending}>
                        <Trash2 />
                        {t('gs.delete.action')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

const BackupsMenu = ({ account, client }: { account: GsAccount; client: GsClient | null | undefined }) => {
    const { t } = useTranslation()
    const qc = useQueryClient()
    const [open, setOpen] = useState(false)
    const backups = useQuery({ queryKey: ['gs', 'backups', account.puuid], queryFn: () => loadBackups(account.puuid), enabled: open })
    const restore = useMutation({
        mutationFn: (i: number) => restoreBackup(qc, account, backups.data![i]!),
        onSuccess: () => toast.success(t('gs.backups.restored')),
        onError: (e) => toast.error(t('gs.apply.failed', { message: String(e) }))
    })
    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost">
                    <History />
                    {t('gs.actions.backups')}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t('gs.backups.hint')}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {!backups.data?.length && <p className="px-2 py-1.5 text-sm text-muted-foreground">{t('gs.backups.none')}</p>}
                {backups.data?.map((b, i) => {
                    const needsSignIn = b.kind === 'cloud' && client?.puuid !== account.puuid
                    return (
                        <DropdownMenuItem key={b.at} disabled={needsSignIn || restore.isPending} onSelect={() => restore.mutate(i)} title={needsSignIn ? t('gs.backups.needSignIn') : undefined}>
                            <span className="flex-1">{t(`gs.backups.${b.kind}`)}</span>
                            <span className="text-xs text-muted-foreground">{timeAgo(b.at)}</span>
                        </DropdownMenuItem>
                    )
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

const AccountDetail = ({ account, state, accounts, names, client }: { account: GsAccount; state: GsState; accounts: GsAccount[]; names: Record<string, string>; client: GsClient | null | undefined }) => {
    const { t } = useTranslation()
    const qc = useQueryClient()
    const view = useAccountView(account)
    const [dialog, setDialog] = useState<'save' | 'export' | 'copy' | 'delete' | null>(null)
    const name = names[account.puuid]
    const pending = state.pending[account.puuid] ?? []
    const excluded = state.excluded.includes(account.puuid)

    if (view.isPending) return <Skeleton className="h-96" />
    if (view.error || !view.data) return <p className="text-sm text-loss">{String(view.error)}</p>
    const v = view.data
    const available = presentCategories(pick(v, [...CATEGORIES]))
    const source = { puuid: account.puuid, name }

    return (
        <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                    <h2 className="truncate font-display text-2xl font-bold">{name ?? t('gs.unknown')}</h2>
                    <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        <span className="uppercase">{account.region}</span>
                        <span className="font-mono">{account.puuid.slice(0, 8)}</span>
                        <span>{v.cloudAt ? t('gs.source.cloud', { when: timeAgo(v.cloudAt) }) : t('gs.source.local')}</span>
                    </p>
                </div>
                <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" onClick={() => setDialog('copy')} disabled={!available.length}>
                        <Send />
                        {t('gs.actions.copyTo')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setDialog('save')} disabled={!available.length}>
                        <Save />
                        {t('gs.actions.savePreset')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDialog('export')} disabled={!available.length}>
                        <Download />
                        {t('gs.actions.export')}
                    </Button>
                    <BackupsMenu account={account} client={client} />
                    <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-loss" onClick={() => setDialog('delete')} aria-label={t('gs.delete.action')} title={t('gs.delete.action')}>
                        <Trash2 />
                    </Button>
                </div>
            </div>

            {!v.cloudAt && <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">{t('gs.source.localHint')}</p>}

            {pending.length > 0 && (
                <div className="rounded-md border border-gold/40 bg-gold/5 p-3 text-sm">
                    <p className="font-medium">{t('gs.pending.title')}</p>
                    <p className="mb-2 text-xs text-muted-foreground">{t('gs.pending.hint')}</p>
                    <ul className="flex flex-col gap-1">
                        {pending.map((p, i) => (
                            <li key={p.at} className="flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate">
                                    {p.label} · {p.patch ? t('gs.settings.count', { count: p.patch.set.length + p.patch.remove.length }) : p.keyOps ? t('gs.settings.count', { count: p.keyOps.length }) : p.categories.map((c) => t(`gs.categories.${c}`)).join(', ')}
                                </span>
                                <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label={t('gs.pending.remove')}
                                    onClick={() =>
                                        void updateState(qc, (s) => {
                                            const list = (s.pending[account.puuid] ?? []).filter((_, j) => j !== i)
                                            const next = { ...s.pending, [account.puuid]: list }
                                            if (!list.length) delete next[account.puuid]
                                            return { ...s, pending: next }
                                        })
                                    }
                                >
                                    <X />
                                </Button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {state.defaultId && (
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input type="checkbox" className="size-4 accent-primary" checked={excluded} onChange={(e) => void updateState(qc, (s) => ({ ...s, excluded: e.target.checked ? [...s.excluded, account.puuid] : s.excluded.filter((x) => x !== account.puuid) }))} />
                    {t('gs.auto.exclude')}
                </label>
            )}

            <Tabs defaultValue="crosshair">
                <TabsList>
                    {CATEGORIES.map((c) => (
                        <TabsTrigger key={c} value={c}>
                            {t(`gs.categories.${c}`)}
                        </TabsTrigger>
                    ))}
                </TabsList>
                <TabsContent value="crosshair" className="pt-3">
                    <CrosshairTab view={v} account={account} client={client} />
                </TabsContent>
                <TabsContent value="keybinds" className="pt-3">
                    <KeybindsEditor view={v} account={account} client={client} />
                </TabsContent>
                {(['mouse', 'audio', 'video', 'other'] as const).map((c) => (
                    <TabsContent key={c} value={c} className="pt-3">
                        <SettingsEditor view={v} account={account} client={client} category={c} />
                    </TabsContent>
                ))}
            </Tabs>

            {dialog === 'save' && (
                <NameDialog
                    open
                    onOpenChange={(o) => !o && setDialog(null)}
                    title={t('gs.actions.savePreset')}
                    available={available}
                    defaultName={name ?? t('gs.unknown')}
                    action={t('gs.actions.savePreset')}
                    onSubmit={async (n, cats) => {
                        await updateState(qc, (s) => ({ ...s, presets: [...s.presets, newPreset(n, cats, pick(v, cats), source)] }))
                        toast.success(t('gs.presets.saved'))
                    }}
                />
            )}
            {dialog === 'export' && (
                <NameDialog
                    open
                    onOpenChange={(o) => !o && setDialog(null)}
                    title={t('gs.actions.export')}
                    available={available}
                    defaultName={name?.replace('#', '-') ?? account.puuid.slice(0, 8)}
                    action={t('gs.actions.export')}
                    onSubmit={(n, cats) => download(t, newPreset(n, cats, pick(v, cats), source))}
                />
            )}
            {dialog === 'copy' && <ApplyDialog open onOpenChange={(o) => !o && setDialog(null)} label={name ?? t('gs.unknown')} data={pick(v, available)} available={available} accounts={accounts} names={names} client={client} exclude={account.puuid} />}
            {dialog === 'delete' && <DeleteDialog account={account} name={name} gameRunning={!!client?.gameRunning && client.puuid === account.puuid} onClose={() => setDialog(null)} />}
        </div>
    )
}

// ---- Names ----

const NAME_GAP = 2_500
const MISS_RETRY = 7 * 86_400_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Looks up unknown accounts on Henrik one by one while the page is open; results are kept in the app data. */
const useAutoNames = (accounts: GsAccount[], names: Record<string, string>, state: GsState | undefined, signedIn: string | undefined) => {
    const qc = useQueryClient()
    const [left, setLeft] = useState(0)
    const todo = useMemo(() => (state ? accounts.filter((a) => !names[a.puuid] && !(Date.now() - (state.nameMisses[a.puuid] ?? 0) < MISS_RETRY)).map((a) => a.puuid) : []), [accounts, names, state])
    const key = todo.join(',')

    useEffect(() => {
        if (!key) return
        let cancelled = false
        void (async () => {
            const list = key.split(',')
            for (let i = 0; i < list.length && !cancelled; i++) {
                setLeft(list.length - i)
                const puuid = list[i]!
                // The account may be deleted while its request is in flight.
                const record = async (fn: (s: GsState) => GsState) => {
                    if ((await invoke<GsAccount[]>('gs_accounts')).some((a) => a.puuid === puuid)) await updateState(qc, fn)
                }
                try {
                    const acc = await fetchAccountByPuuid(puuid)
                    if (acc?.name) await record((s) => ({ ...s, names: { ...s.names, [puuid]: { name: acc.name, tag: acc.tag } } }))
                } catch (e) {
                    if (!isApiError(e) || e.kind === 'noKey' || e.kind === 'network') break
                    if (e.kind === 'rateLimited') {
                        await sleep(e.retryAfter * 1000)
                        i--
                        continue
                    }
                    await record((s) => ({ ...s, nameMisses: { ...s.nameMisses, [puuid]: Date.now() } }))
                }
                await sleep(NAME_GAP)
            }
            if (!cancelled) setLeft(0)
        })()
        return () => {
            cancelled = true
            setLeft(0)
        }
        // Runs once per visit; names found along the way don't restart it.
    }, [key.length > 0])

    // Forget names of accounts whose folder is gone (deleted here or by hand).
    useEffect(() => {
        if (!state || !accounts.length) return
        // The signed-in account may not have a folder yet.
        const live = new Set([...accounts.map((a) => a.puuid), signedIn])
        const orphan = (r: Record<string, unknown>) => Object.keys(r).some((k) => !live.has(k))
        if (!orphan(state.names) && !orphan(state.nameMisses)) return
        const keep = <T,>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).filter(([k]) => live.has(k)))
        void updateState(qc, (s) => ({ ...s, names: keep(s.names), nameMisses: keep(s.nameMisses) }))
    }, [accounts, state, signedIn, qc])

    return left
}

// ---- Page ----

const GameSettingsPage = () => {
    const { t } = useTranslation()
    const qc = useQueryClient()
    const state = useGsState()
    const accounts = useGsAccounts()
    const client = useGsClient(10_000)
    const names = useNames(state.data)
    const [selected, setSelected] = useState<string | null>(null)
    // The signed-in account's latest cloud copy.
    useQuery({ queryKey: ['gs', 'cloud', client.data?.puuid], queryFn: () => captureCloud(qc), enabled: !!client.data, staleTime: 60_000, retry: false })

    const list = accounts.data ?? []
    const namesLeft = useAutoNames(list, names, state.data, client.data?.puuid)

    const current = list.find((a) => a.puuid === (selected ?? client.data?.puuid)) ?? list[0]
    const c = client.data

    return (
        <div className="mx-auto max-w-7xl px-8 py-8">
            <div className="mb-6 flex flex-wrap items-end gap-4">
                <div className="min-w-0 flex-1">
                    <h1 className="text-3xl font-bold uppercase">{t('gs.title')}</h1>
                    <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t('gs.intro')}</p>
                </div>
                <p className={cn('text-sm', c ? 'text-win' : 'text-muted-foreground')}>
                    {c ? t('gs.client.signedIn', { name: c.name ? `${c.name}#${c.tag}` : c.puuid.slice(0, 8) }) : t('gs.client.closed')}
                    {c?.gameRunning && <span className="ml-2 text-gold">· {t('gs.client.gameRunning')}</span>}
                </p>
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                        void qc.invalidateQueries({ queryKey: ['gs'] })
                    }}
                >
                    <RefreshCw />
                    {t('gs.actions.refresh')}
                </Button>
            </div>

            {state.data && <PresetsSection state={state.data} accounts={list} names={names} client={c} />}

            <div className="mt-6 grid gap-6 lg:grid-cols-[17rem_1fr]">
                <aside className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xs font-semibold text-muted-foreground uppercase">
                            {t('gs.accounts')} ({list.length})
                        </h2>
                        {namesLeft > 0 && (
                            <span className="flex items-center gap-1.5 text-xs text-muted-foreground" title={t('gs.findNamesHint')}>
                                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                                {t('gs.findingNames', { n: namesLeft })}
                            </span>
                        )}
                    </div>
                    {accounts.isPending && <Skeleton className="h-64" />}
                    {!accounts.isPending && !list.length && <p className="text-sm text-muted-foreground">{t('gs.noAccounts')}</p>}
                    <ul className="flex flex-col gap-1">
                        {list.map((a) => {
                            const active = a.puuid === current?.puuid
                            const pending = state.data?.pending[a.puuid]?.length ?? 0
                            return (
                                <li key={a.puuid}>
                                    <button
                                        type="button"
                                        onClick={() => setSelected(a.puuid)}
                                        aria-current={active}
                                        className={cn('flex w-full flex-col rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent', active ? 'border-primary/60 bg-primary/5' : 'border-transparent')}
                                    >
                                        <span className="flex items-center gap-2">
                                            <span className={cn('min-w-0 flex-1 truncate text-sm font-medium', !names[a.puuid] && 'text-muted-foreground')}>{names[a.puuid] ?? `${t('gs.unknown')} · ${a.puuid.slice(0, 8)}`}</span>
                                            {c?.puuid === a.puuid && <span className="size-2 shrink-0 rounded-full bg-win" title={t('gs.badge.signedIn')} />}
                                        </span>
                                        <span className="flex gap-2 text-xs text-muted-foreground">
                                            <span>{a.modified ? timeAgo(a.modified) : '—'}</span>
                                            {pending > 0 && <span className="text-gold">{t('gs.badge.pending', { n: pending })}</span>}
                                        </span>
                                    </button>
                                </li>
                            )
                        })}
                    </ul>
                </aside>
                {current && state.data ? <AccountDetail key={current.puuid} account={current} state={state.data} accounts={list} names={names} client={c} /> : null}
            </div>
        </div>
    )
}

export default GameSettingsPage
