import { create } from 'zustand'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

// App updates via tauri-plugin-updater (endpoint and public key in tauri.conf.json).
type Status = 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'error'

type State = {
    status: Status
    update: Update | null
    progress: number | null
    error: string | null
    check: () => Promise<Update | null>
    install: () => Promise<void>
}

export const useUpdate = create<State>()((set, get) => ({
    status: 'idle',
    update: null,
    progress: null,
    error: null,
    check: async () => {
        set({ status: 'checking', error: null })
        try {
            const update = await check()
            set({ status: update ? 'available' : 'latest', update })
            return update
        } catch (e) {
            set({ status: 'error', error: String(e) })
            return null
        }
    },
    install: async () => {
        const { update } = get()
        if (!update) return
        set({ status: 'downloading', progress: null, error: null })
        let total = 0
        let done = 0
        try {
            await update.downloadAndInstall((e) => {
                if (e.event === 'Started') total = e.data.contentLength ?? 0
                else if (e.event === 'Progress') {
                    done += e.data.chunkLength
                    set({ progress: total ? Math.min(100, (done / total) * 100) : null })
                }
            })
            // The NSIS installer closes the app on Windows; relaunch covers other cases.
            await relaunch()
        } catch (e) {
            set({ status: 'error', error: String(e) })
        }
    }
}))
