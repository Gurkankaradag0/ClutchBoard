import { invoke } from '@tauri-apps/api/core'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

// Startup window: installs a pending update before the app opens, like Discord's updater.
// Any failure (offline, timeout, bad download) just opens the app.

const TEXT = {
    tr: { checking: 'Güncellemeler denetleniyor…', downloading: 'Güncelleme indiriliyor', installing: 'Güncelleme kuruluyor…', starting: 'Başlatılıyor…' },
    en: { checking: 'Checking for updates…', downloading: 'Downloading update', installing: 'Installing update…', starting: 'Starting…' }
}
const CHECK_TIMEOUT_MS = 8_000
// Too short a splash just flickers.
const MIN_SHOWN_MS = 900

const saved = (() => {
    try {
        return localStorage.getItem('clutchboard:lang')
    } catch {
        return null
    }
})()
const text = TEXT[(saved ?? navigator.language).toLowerCase().startsWith('tr') ? 'tr' : 'en']

const status = (s: string, state = 'idle') => {
    document.getElementById('status')!.textContent = s
    document.body.dataset.state = state
}
const progress = (pct: number) => {
    document.getElementById('progress')!.style.width = `${pct}%`
}

const started = Date.now()
const open = async () => {
    status(text.starting)
    await new Promise((r) => setTimeout(r, Math.max(0, MIN_SHOWN_MS - (Date.now() - started))))
    await invoke('startup_done')
}

const run = async () => {
    status(text.checking)
    if (import.meta.env.DEV) return open()
    let update: Update | null = null
    try {
        update = await Promise.race([check(), new Promise<null>((r) => setTimeout(() => r(null), CHECK_TIMEOUT_MS))])
    } catch {
        // Offline or no release reachable.
    }
    if (!update) return open()

    status(`${text.downloading} ${update.version}`, 'downloading')
    let total = 0
    let done = 0
    try {
        await update.downloadAndInstall((e) => {
            if (e.event === 'Started') total = e.data.contentLength ?? 0
            else if (e.event === 'Progress') {
                done += e.data.chunkLength
                if (total) progress(Math.min(100, (done / total) * 100))
            } else status(text.installing)
        })
        // The installer closes the app on Windows; relaunch covers other cases.
        await relaunch()
    } catch {
        await open()
    }
}

void run()
