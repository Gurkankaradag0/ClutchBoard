import { useState, type FormEvent } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiKeyStatus, clearCache, setApiKey } from '@/lib/api'
import { LANGS } from '@/i18n'
import { cn } from '@/lib/utils'
import { useRecent } from '@/stores/recent'
import { useUpdate } from '@/stores/update'
import { useSeen } from '@/stores/players'

const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
    <section className="grid gap-4 border-b py-6 md:grid-cols-[16rem_1fr]">
        <div>
            <h2 className="text-sm font-semibold uppercase">{title}</h2>
            {hint && <p className="mt-1 text-sm text-muted-foreground">{hint}</p>}
        </div>
        <div className="flex flex-col items-start gap-3">{children}</div>
    </section>
)

const formatBytes = (n: number) => (n === 0 ? '0 KB' : n < 1024 * 1024 ? `${Math.max(0.1, n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

const LANG_NAMES: Record<string, string> = { tr: 'Türkçe', en: 'English' }

const SettingsPage = () => {
    const { t, i18n } = useTranslation()
    const qc = useQueryClient()
    const [key, setKey] = useState('')
    const status = useQuery({ queryKey: ['apiKeyStatus'], queryFn: apiKeyStatus })
    const entries = useRecent((s) => s.entries)
    const { clear: clearOthers, clearFavorites, clearAll } = useRecent()
    const seenCount = useSeen((s) => Object.keys(s.players).length)
    const clearSeen = useSeen((s) => s.clear)
    const version = useQuery({ queryKey: ['appVersion'], queryFn: getVersion, staleTime: Infinity })
    const upd = useUpdate()
    const autostart = useQuery({ queryKey: ['autostart'], queryFn: () => invoke<boolean>('autostart_get') })
    const setAutostart = useMutation({
        mutationFn: (on: boolean) => invoke<void>('autostart_set', { on }),
        onSuccess: () => void qc.invalidateQueries({ queryKey: ['autostart'] }),
        onError: (e) => toast.error(String(e))
    })

    const save = useMutation({
        mutationFn: () => setApiKey(key),
        onSuccess: () => {
            setKey('')
            toast.success(t('settings.saved'))
            void qc.invalidateQueries({ queryKey: ['apiKeyStatus'] })
            // Drop errors cached from requests made without a key.
            void qc.resetQueries({ predicate: (q) => q.state.status === 'error' })
        },
        onError: (e) => toast.error(String(e))
    })

    // Groups: non-favorites, favorites, all.
    const others = entries.filter((e) => !e.favorite).map((e) => e.puuid)
    const favorites = entries.filter((e) => e.favorite).map((e) => e.puuid)
    const usage = useQuery({
        queryKey: ['storageUsage', others, favorites],
        queryFn: () => invoke<{ cache: number; archive: number; groups: [number, number, number] }>('storage_usage', { groups: [others, favorites, [...others, ...favorites]] })
    })
    const remeasure = () => void qc.invalidateQueries({ queryKey: ['storageUsage'] })
    const size = (n: number | undefined) => (n === undefined ? '…' : formatBytes(n))
    const run = (fn: () => void) => () => {
        fn()
        // Deletion is async; measure again shortly after.
        setTimeout(remeasure, 400)
    }

    const wipe = useMutation({
        mutationFn: clearCache,
        onSuccess: () => {
            toast.success(t('settings.cacheCleared'))
            remeasure()
        },
        onError: (e) => toast.error(String(e))
    })

    const submit = (e: FormEvent) => {
        e.preventDefault()
        if (key.trim()) save.mutate()
    }

    return (
        <div className="mx-auto max-w-4xl px-8 py-10">
            <h1 className="mb-4 text-3xl font-bold uppercase">{t('settings.title')}</h1>

            <Section title={t('settings.apiKey')} hint={t('settings.apiKeyHint')}>
                <p className={cn('text-sm font-medium', status.data ? 'text-win' : 'text-loss')}>{status.data ? t('settings.apiKeySet') : t('settings.apiKeyMissing')}</p>
                <form onSubmit={submit} className="flex w-full max-w-md gap-2">
                    <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="HDEV-xxxxxxxx-…" aria-label={t('settings.apiKey')} autoComplete="off" spellCheck={false} />
                    <Button type="submit" disabled={!key.trim() || save.isPending}>
                        {t('settings.save')}
                    </Button>
                </form>
            </Section>

            <Section title={t('update.title')} hint={version.data ? t('update.current', { v: version.data }) : undefined}>
                <p className={cn('text-sm', upd.status === 'error' ? 'text-loss' : upd.status === 'available' ? 'text-gold' : 'text-muted-foreground')} aria-live="polite">
                    {upd.status === 'checking' && t('update.checking')}
                    {upd.status === 'latest' && t('update.latest')}
                    {upd.status === 'available' && t('update.available', { v: upd.update?.version })}
                    {upd.status === 'downloading' && t('update.downloading', { p: upd.progress === null ? '…' : `${Math.round(upd.progress)}%` })}
                    {upd.status === 'error' && t('update.error', { message: upd.error })}
                </p>
                {upd.status === 'available' ? (
                    <Button onClick={() => void upd.install()}>{t('update.install')}</Button>
                ) : (
                    <Button variant="outline" onClick={() => void upd.check()} disabled={upd.status === 'checking' || upd.status === 'downloading'}>
                        {t('update.check')}
                    </Button>
                )}
            </Section>

            <Section title={t('settings.startup')} hint={t('settings.startupHint')}>
                <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4 accent-primary" checked={autostart.data ?? false} disabled={autostart.isPending || setAutostart.isPending} onChange={(e) => setAutostart.mutate(e.target.checked)} />
                    {t('settings.autostart')}
                </label>
            </Section>

            <Section title={t('settings.language')}>
                <Select value={i18n.language} onValueChange={(v) => void i18n.changeLanguage(v)}>
                    <SelectTrigger className="w-48" aria-label={t('settings.language')}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {LANGS.map((l) => (
                            <SelectItem key={l} value={l}>
                                {LANG_NAMES[l]}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </Section>

            <Section title={t('settings.cache')} hint={t('settings.cacheHint')}>
                <p className="text-sm text-muted-foreground">{t('settings.cacheSize', { cache: size(usage.data?.cache), archive: size(usage.data?.archive) })}</p>
                <Button variant="outline" onClick={() => wipe.mutate()} disabled={wipe.isPending}>
                    {t('settings.clearCache')} ({size(usage.data?.cache)})
                </Button>
            </Section>

            <Section title={t('settings.history')} hint={t('settings.historyHint')}>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={run(clearOthers)} disabled={!others.length}>
                        {t('settings.clearOthers', { n: others.length, size: size(usage.data?.groups[0]) })}
                    </Button>
                    <Button variant="outline" onClick={run(clearFavorites)} disabled={!favorites.length}>
                        {t('settings.clearFavorites', { n: favorites.length, size: size(usage.data?.groups[1]) })}
                    </Button>
                    <Button variant="destructive" onClick={run(clearAll)} disabled={!entries.length}>
                        {t('settings.clearAll', { size: size(usage.data?.groups[2]) })}
                    </Button>
                </div>
                <Button variant="outline" onClick={clearSeen} disabled={seenCount === 0}>
                    {t('settings.clearSeen', { n: seenCount })}
                </Button>
            </Section>
        </div>
    )
}

export default SettingsPage
