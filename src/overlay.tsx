import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { focusManager, QueryClientProvider } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import '@/lib/context-menu'
import '@/i18n'
import '@/styles/globals.css'
import { queryClient } from '@/lib/query-client'
import { TooltipProvider } from '@/components/ui/tooltip'
import { LivePanel } from '@/components/overlay/live-panel'
import { FriendsPanel } from '@/components/overlay/friends-panel'
import { ChatPanel } from '@/components/overlay/chat-panel'
import { CareerPanel } from '@/components/overlay/career-panel'
import { InventoryPanel } from '@/components/overlay/inventory-panel'
import { cn } from '@/lib/utils'

// Entry for in-game panel windows (src-tauri/src/overlay.rs). The panel id comes from Rust.
// New panels: add a component here and its id to PANELS in overlay.rs.

/** `active`: the panel is shown; hidden panels stop polling. */
type PanelProps = { active: boolean; id: string; title: string }

/** Per-friend windows (`chat-<puuid>`, `career-<puuid>`) share one entry each and the friends panel's opacity. */
const PANELS: Record<string, { title: string; Panel: (props: PanelProps) => React.ReactNode }> = {
    live: { title: 'nav.live', Panel: LivePanel },
    friends: { title: 'chat.friends', Panel: FriendsPanel },
    chat: { title: 'chat.friends', Panel: ChatPanel },
    career: { title: 'chat.career', Panel: CareerPanel },
    inventory: { title: 'local.allSkins', Panel: InventoryPanel }
}

export type OverlayConfig = { panels: Record<string, { hotkey: string | null; opacity: number }> }

const { __OVERLAY__: id = 'live', __OVERLAY_TITLE__: windowTitle } = window as unknown as { __OVERLAY__?: string; __OVERLAY_TITLE__?: string }
const kind = ['chat', 'career', 'inventory'].find((k) => id.startsWith(`${k}-`)) ?? id

const Frame = () => {
    const { t } = useTranslation()
    const [opacity, setOpacity] = useState(0.85)
    const [active, setActive] = useState(true)
    const panel = PANELS[kind]

    useEffect(() => {
        const load = () =>
            void invoke<OverlayConfig>('overlay_config').then((c) => {
                setOpacity(c.panels[id]?.opacity ?? c.panels.friends?.opacity ?? 0.85)
            })
        load()
        const offs = [listen('overlay://config', load), listen<boolean>('overlay://visible', (e) => setActive(e.payload))]
        return () => offs.forEach((off) => void off.then((f) => f()))
    }, [])

    if (!panel) return null
    const { Panel } = panel
    return (
        <div className={'flex h-screen flex-col overflow-hidden rounded-lg border border-white/8 text-foreground'} style={{ backgroundColor: `rgb(15 18 24 / ${opacity})` }}>
            <header data-tauri-drag-region className="flex h-8 shrink-0 cursor-move items-center gap-2 border-b border-white/8 pr-1 pl-3">
                {/* Player names stay as typed: uppercase breaks Turkish i/İ. */}
                <span data-tauri-drag-region className={cn('flex-1 truncate font-display text-xs font-semibold', !windowTitle && 'tracking-wider uppercase')}>
                    {windowTitle || t(panel.title)}
                </span>
                <button type="button" onClick={() => void invoke('overlay_hide', { id })} className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-loss hover:text-white" aria-label={t('overlay.close')}>
                    <X className="size-3.5" />
                </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
                <Panel active={active} id={id} title={windowTitle ?? ''} />
            </div>
        </div>
    )
}

// Panels are shown without activation, so the page may never count as visible or focused and
// TanStack would skip interval refetches. Polling is gated by `active` (overlay://visible) instead.
focusManager.setEventListener(() => () => {})
focusManager.setFocused(true)

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <TooltipProvider delayDuration={300}>
                <Frame />
            </TooltipProvider>
        </QueryClientProvider>
    </StrictMode>
)
