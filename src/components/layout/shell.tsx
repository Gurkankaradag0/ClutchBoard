import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet, useLocation, useMatch, useNavigate, useNavigationType } from 'react-router'
import { ArrowLeft, Crosshair, Search, Settings, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { RiotIdSearch } from '@/components/search/riot-id-search'
import { cn } from '@/lib/utils'
import { ErrorBoundary } from '@/components/error-boundary'
import { useLocalStatus } from '@/lib/local'

export type NavItem = { to: string; label: string; icon: ReactNode; end?: boolean }

// Don't pass a function className to NavLink here: Radix Slot (TooltipTrigger asChild) stringifies it.
const RailLink = ({ to, label, icon, end }: NavItem) => {
    const active = !!useMatch({ path: to, end: !!end })
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <NavLink
                    to={to}
                    end={end}
                    aria-label={label}
                    className={cn(
                        'relative grid size-11 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                        active && 'bg-accent text-foreground before:absolute before:inset-y-2 before:-left-2.5 before:w-0.5 before:rounded-full before:bg-primary'
                    )}
                >
                    {icon}
                </NavLink>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
    )
}

// Same path as docs/brand/mark.svg.
const Mark = () => (
    <svg viewBox="204 228 616 568" className="size-8" aria-hidden>
        <path d="M763.1,578.7 L646.8,579.2 L599.0,632.5 L574.3,645.1 L405.8,646.2 L240.0,787.8 L653.9,735.7Z M812.0,236.2 L434.9,236.2 L332.8,295.4 L212.0,770.3 L368.4,636.7 L436.0,371.7 L479.9,333.3 L671.5,332.8 L593.5,468.9 L767.5,347.6Z" fill="var(--primary)" />
    </svg>
)

export const Shell = () => {
    const { t } = useTranslation()
    // Always visible; green dot while Valorant is running.
    const { data: local } = useLocalStatus()
    const dot = local ? <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-win ring-2 ring-card" aria-hidden /> : null
    const extraNav: NavItem[] = [
        {
            to: '/me',
            label: t('nav.me'),
            icon: (
                <>
                    {<UserRound className="size-5" />}
                    {dot}
                </>
            )
        },
        {
            to: '/live',
            label: t('nav.live'),
            icon: (
                <>
                    {<Crosshair className="size-5" />}
                    {dot}
                </>
            )
        }
    ]
    const location = useLocation()
    const { pathname } = location
    const navType = useNavigationType()
    const navigate = useNavigate()
    const home = pathname === '/'
    const main = useRef<HTMLElement>(null)
    // Content scrolls inside <main>, so browser scroll restoration doesn't apply: new pages start at
    // the top, back/forward restores the position saved for that history entry.
    const positions = useRef(new Map<string, number>())
    // Keep effect bodies in braces: scrollTo() returns a Promise in recent Chromium.
    useEffect(() => {
        const el = main.current
        if (!el) return
        if (navType !== 'POP') {
            el.scrollTo(0, 0)
            return
        }
        // Content may take a few frames to render; retry for ~1s.
        const target = positions.current.get(location.key) ?? 0
        let tries = 0
        let raf = 0
        const tick = () => {
            el.scrollTop = target
            if (Math.abs(el.scrollTop - target) > 2 && tries++ < 60) raf = requestAnimationFrame(tick)
        }
        tick()
        return () => cancelAnimationFrame(raf)
    }, [location.key, navType])
    // idx 0 is the first entry, nothing to go back to.
    const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0

    return (
        <div className="flex h-full">
            <nav aria-label={t('app.name')} className="flex w-16 shrink-0 flex-col items-center gap-2 border-r bg-card/60 py-4">
                <NavLink to="/" aria-label={t('app.name')} className="mb-4 text-foreground">
                    <Mark />
                </NavLink>
                <RailLink to="/" end label={t('nav.search')} icon={<Search className="size-5" />} />
                {extraNav.map((n) => (
                    <RailLink key={n.to} {...n} />
                ))}
                <div className="mt-auto">
                    <RailLink to="/settings" label={t('nav.settings')} icon={<Settings className="size-5" />} />
                </div>
            </nav>
            <div className="flex min-w-0 flex-1 flex-col">
                {!home && (
                    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-6">
                        <Button variant="ghost" size="icon-sm" onClick={() => navigate(-1)} disabled={!canGoBack} aria-label={t('nav.back')}>
                            <ArrowLeft />
                        </Button>
                        <RiotIdSearch className="w-full max-w-md" />
                    </header>
                )}
                <main ref={main} onScroll={(e) => positions.current.set(location.key, e.currentTarget.scrollTop)} className="min-h-0 flex-1 overflow-y-auto">
                    <ErrorBoundary key={pathname}>
                        <Outlet />
                    </ErrorBoundary>
                </main>
            </div>
        </div>
    )
}
