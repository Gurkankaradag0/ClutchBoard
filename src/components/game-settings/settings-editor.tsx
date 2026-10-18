import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { categoryOf, editSettings, settingName, useCatalog, type AccountView, type Category, type Entry, type GsAccount, type GsClient, type Gus, type Patch } from '@/lib/game-settings'

export const humanize = (s: string) =>
    s
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .replace(/_/g, ' ')

const COMMIT_DELAY = 600

type Value = Entry['value']

/** Edits one value; text, numbers and sliders are committed after a short pause. */
const Control = ({ value, volume, onCommit }: { value: Value; volume: boolean; onCommit: (v: Value) => void }) => {
    const [draft, setDraft] = useState(value)
    // Last value sent, so re-renders before the view refreshes don't send it twice.
    const sent = useRef(value)
    useEffect(() => {
        setDraft(value)
        sent.current = value
    }, [value])
    useEffect(() => {
        if (draft === sent.current || typeof draft === 'boolean') return
        const id = setTimeout(() => {
            sent.current = draft
            onCommit(draft)
        }, COMMIT_DELAY)
        return () => clearTimeout(id)
    }, [draft, onCommit])

    if (typeof value === 'boolean') return <input type="checkbox" className="size-4 accent-primary" checked={value} onChange={(e) => onCommit(e.target.checked)} />
    if (typeof value === 'number' && volume) {
        return (
            <span className="flex items-center gap-2">
                <input type="range" className="w-32 accent-primary" min={0} max={1} step={0.01} value={Number(draft)} onChange={(e) => setDraft(Number(e.target.value))} />
                <span className="w-10 text-right text-xs tabular-nums">{Math.round(Number(draft) * 100)}%</span>
            </span>
        )
    }
    if (typeof value === 'number') return <input type="number" step="any" className="h-7 w-24 rounded-md border bg-transparent px-2 text-right text-sm tabular-nums" value={String(draft)} onChange={(e) => e.target.value !== '' && setDraft(Number(e.target.value))} />
    return <input type="text" className="h-7 w-40 rounded-md border bg-transparent px-2 text-sm" value={String(draft)} onChange={(e) => setDraft(e.target.value)} />
}

type Row = { id: string; label: string; value: Value; kind: 'cloud' | 'gus'; section?: string; key?: string }

const gusValue = (raw: string): Value => (/^(true|false)$/i.test(raw) ? raw.toLowerCase() === 'true' : raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw)
const gusText = (v: Value) => (typeof v === 'boolean' ? (v ? 'True' : 'False') : String(v))

/** Editable settings of one category: values the account changed, plus any setting seen on another account. */
export const SettingsEditor = ({ view, account, client, category }: { view: AccountView; account: GsAccount; client: GsClient | null | undefined; category: Category }) => {
    const { t } = useTranslation()
    const qc = useQueryClient()
    const catalog = useCatalog()

    const rows: Row[] = []
    for (const k of ['boolSettings', 'intSettings', 'floatSettings', 'stringSettings'] as const) {
        for (const e of view.blob[k] ?? []) if (categoryOf(e.settingEnum) === category) rows.push({ id: e.settingEnum, label: humanize(settingName(e.settingEnum)), value: e.value, kind: 'cloud' })
    }
    if (category === 'video') {
        for (const [section, values] of Object.entries(view.gus)) {
            for (const [key, raw] of Object.entries(values)) rows.push({ id: `${section}|${key}`, label: humanize(key.replace(/^sg\./, '').replace(/^b(?=[A-Z])/, '')), value: gusValue(raw), kind: 'gus', section, key })
        }
    }
    rows.sort((a, b) => a.label.localeCompare(b.label))
    const present = new Set(rows.map((r) => r.id))
    const addable = (catalog.data ?? []).filter((c) => c.category === category && !present.has(c.settingEnum)).sort((a, b) => settingName(a.settingEnum).localeCompare(settingName(b.settingEnum)))

    const edit = useMutation({
        mutationFn: ({ patch, gus }: { patch: Patch; gus: Gus | null }) => editSettings(qc, account, client, patch, gus, t('gs.settings.pendingLabel')),
        onSuccess: (r) => {
            if (r.local === 'blocked' && r.cloud === 'none') toast.error(t('gs.settings.blocked'))
            else toast.success(r.cloud === 'pending' ? t('gs.settings.savedPending') : t('gs.settings.saved'), { id: 'gs-edit', description: r.cloud === 'applied' && client?.gameRunning ? t('gs.apply.gameRunning') : undefined })
        },
        onError: (e) => toast.error(t('gs.apply.failed', { message: String(e) }))
    })

    const commit = (row: Row, v: Value) =>
        edit.mutate(
            row.kind === 'gus'
                ? { patch: { set: [], remove: [] }, gus: { [row.section!]: { [row.key!]: gusText(v) } } }
                : {
                      patch: { set: [{ settingEnum: row.id, value: v }], remove: [] },
                      gus: null
                  }
        )

    return (
        <div className="flex flex-col gap-3">
            {client?.puuid !== account.puuid && <p className="text-xs text-muted-foreground">{t('gs.settings.offlineHint')}</p>}
            {rows.length === 0 && <p className="py-4 text-sm text-muted-foreground">{t('gs.empty')}</p>}
            {rows.length > 0 && (
                <ul className="divide-y rounded-md border">
                    {rows.map((r) => (
                        <li key={r.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                            <span className="min-w-0 flex-1 truncate text-muted-foreground" title={r.kind === 'gus' ? `${r.section} / ${r.key}` : r.id}>
                                {r.label}
                                {r.kind === 'gus' && <span className="ml-2 text-[0.6875rem] text-muted-foreground/70">{t('gs.settings.local')}</span>}
                            </span>
                            <Control value={r.value} volume={r.kind === 'cloud' && /Volume/.test(r.id) && typeof r.value === 'number' && r.value <= 1} onCommit={(v) => commit(r, v)} />
                            {r.kind === 'cloud' ? (
                                <Button size="icon-sm" variant="ghost" className="text-muted-foreground" title={t('gs.settings.reset')} aria-label={t('gs.settings.reset')} disabled={edit.isPending} onClick={() => edit.mutate({ patch: { set: [], remove: [r.id] }, gus: null })}>
                                    <RotateCcw />
                                </Button>
                            ) : (
                                <span className="size-7" />
                            )}
                        </li>
                    ))}
                </ul>
            )}
            {addable.length > 0 && (
                <Select
                    value=""
                    onValueChange={(id) => {
                        const item = addable.find((c) => c.settingEnum === id)
                        if (item) edit.mutate({ patch: { set: [{ settingEnum: id, value: item.sample }], remove: [] }, gus: null })
                    }}
                >
                    <SelectTrigger size="sm" className="w-72">
                        <SelectValue placeholder={t('gs.settings.add', { count: addable.length })} />
                    </SelectTrigger>
                    <SelectContent>
                        {addable.map((c) => (
                            <SelectItem key={c.settingEnum} value={c.settingEnum}>
                                {humanize(settingName(c.settingEnum))}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            )}
        </div>
    )
}
