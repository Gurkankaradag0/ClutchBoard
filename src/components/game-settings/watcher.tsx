import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { invoke } from '@tauri-apps/api/core'
import { applyCloud, applyLocal, captureCloud, updateState, useGsClient, useGsState, type GsAccount, type GsState, type Pending } from '@/lib/game-settings'

// Lockfile check is a local file read; the client is only asked once it exists.
const POLL = 5_000

/**
 * Applies pending changes and the default preset when an account signs in to the Riot Client.
 * Polls only while there's something to apply.
 */
export const GameSettingsWatcher = () => {
    const { t } = useTranslation()
    const qc = useQueryClient()
    const { data: state } = useGsState()
    const active = !!state && ((state.auto.enabled && !!state.defaultId) || Object.keys(state.pending).length > 0)
    const { data: client } = useGsClient(active ? POLL : false)
    const handled = useRef(new Set<string>())

    useEffect(() => {
        if (!client) {
            handled.current.clear()
            return
        }
        if (!active || handled.current.has(client.puuid)) return
        handled.current.add(client.puuid)
        const puuid = client.puuid
        const name = client.name ? `${client.name}#${client.tag}` : puuid.slice(0, 8)

        const run = async () => {
            const s = qc.getQueryData<GsState>(['gs', 'state'])
            if (!s) return
            const jobs: (Pending & { preset?: string })[] = [...(s.pending[puuid] ?? [])]
            const def = s.presets.find((p) => p.id === s.defaultId)
            const cats = def ? s.auto.categories.filter((c) => def.categories.includes(c)) : []
            if (s.auto.enabled && def && cats.length && s.applied[puuid] !== def.id && !s.excluded.includes(puuid) && def.source?.puuid !== puuid) {
                jobs.unshift({ label: def.name, categories: cats, data: def.data, at: Date.now(), preset: def.id })
            }
            // Keep a fresh snapshot of every account that signs in.
            await captureCloud(qc).catch(() => null)
            if (!jobs.length) return
            for (const job of jobs) {
                try {
                    const crosshair = await applyCloud(qc, puuid, job.data, job.categories, t('gs.crosshair.defaultName'), { ops: job.ops, patch: job.patch, keyOps: job.keyOps })
                    // Pending jobs wrote their video part when queued; the default preset does it now, before the game starts.
                    if (job.preset && job.categories.includes('video')) {
                        const account = (await invoke<GsAccount[]>('gs_accounts')).find((a) => a.puuid === puuid)
                        if (account) await applyLocal(account, job.data).catch(() => false)
                    }
                    toast.success(t('gs.autoApplied', { preset: job.label, name }), { description: crosshair === 'full' ? t('gs.apply.crosshairFull') : client.gameRunning ? t('gs.apply.gameRunning') : undefined })
                } catch (e) {
                    // Changed or deleted in game since; drop the job instead of retrying forever.
                    if (String(e).includes('crosshair profile not found')) {
                        toast.warning(t('gs.crosshair.opMissing', { label: job.label }))
                        continue
                    }
                    toast.error(t('gs.apply.failed', { message: String(e) }))
                    return
                }
            }
            await updateState(qc, (st) => {
                const pending = { ...st.pending }
                delete pending[puuid]
                const preset = jobs.find((j) => j.preset)?.preset
                return { ...st, pending, applied: preset ? { ...st.applied, [puuid]: preset } : st.applied }
            })
        }
        void run()
    }, [client, active, qc, t])

    // Remember the signed-in account's name for the account list.
    useEffect(() => {
        if (!client?.name || !state || state.names[client.puuid]?.name === client.name) return
        void updateState(qc, (s) => ({ ...s, names: { ...s.names, [client.puuid]: { name: client.name!, tag: client.tag ?? '' } } }))
    }, [client, state, qc])

    return null
}
