// Bundled to main.js by tools/release.ts. Uses the global Tauri API (withGlobalTauri).

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
const { invoke } = (window as unknown as { __TAURI__: { core: { invoke: Invoke } } }).__TAURI__.core

const TEXT = {
    tr: { installing: 'ClutchBoard kuruluyor…', starting: 'Başlatılıyor…', failed: 'Kurulum tamamlanamadı', retry: 'Tekrar dene' },
    en: { installing: 'Installing ClutchBoard…', starting: 'Starting…', failed: 'Setup could not finish', retry: 'Try again' }
}
const lang = navigator.language.toLowerCase().startsWith('tr') ? 'tr' : 'en'
const text = TEXT[lang]
document.documentElement.lang = lang

const $ = (id: string) => document.getElementById(id)!
const setState = (state: 'installing' | 'done' | 'error', status: string) => {
    document.body.dataset.state = state
    $('status').textContent = status
}

// Too fast an install would just flash the window.
const MIN_SHOWN_MS = 1500

const run = async () => {
    setState('installing', text.installing)
    const started = Date.now()
    try {
        await invoke('install')
        await new Promise((r) => setTimeout(r, Math.max(0, MIN_SHOWN_MS - (Date.now() - started))))
        setState('done', text.starting)
        await invoke('launch')
    } catch (e) {
        setState('error', text.failed)
        $('error').textContent = String(e)
    }
}

$('retry').textContent = text.retry
$('retry').addEventListener('click', () => void run())
$('close').addEventListener('click', () => void invoke('quit'))
invoke<string>('version').then((v) => ($('version').textContent = `v${v}`))
void run()
