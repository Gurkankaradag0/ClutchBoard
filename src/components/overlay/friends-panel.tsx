import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useTranslation } from 'react-i18next'
import { queueLabel } from '@/lib/api'
import { unreadCounts, useFriends, useMessages, type Friend } from '@/lib/local'
import { cn } from '@/lib/utils'

const ORDER: Record<string, number> = { chat: 0, dnd: 1, away: 2 }
const PRODUCTS: Record<string, string> = { valorant: 'VALORANT', league_of_legends: 'League of Legends', tft: 'Teamfight Tactics', riot_client: 'Riot Client', mobile: 'Riot Mobile', bacon: 'Legends of Runeterra', lion: '2XKO' }
/** League / TFT queue ids with a translated name (`chat.lolQueues.<id>`). */
const LOL_QUEUES = new Set(['0', '400', '420', '430', '440', '450', '480', '490', '700', '900', '1700', '1090', '1100', '1130', '1160'])

/** Games get a group each, in this order (unknown ones after); Riot Client and Riot Mobile go under "Online". */
const GAMES = ['valorant', 'league_of_legends', 'tft']
const CLIENTS = new Set(['riot_client', 'mobile'])

const groupOf = (f: Friend) => (!f.state ? 'offline' : f.product && !CLIENTS.has(f.product) ? f.product : 'online')

/** Riot sets dnd on its own while in a game or queue, so it reads as "busy playing". */
const playing = (f: Friend) => f.state === 'dnd' || (!!f.activity && f.activity !== 'lobby')

/** Like the Riot Client: green = online, blue = in game or queue, crescent = away, ring = offline. */
const StatusIcon = ({ f }: { f: Friend }) => {
    const state = f.state
    if (state === 'away') return <span className="size-2.5 shrink-0 rounded-full bg-gold [mask-image:radial-gradient(circle_at_25%_25%,transparent_4px,#000_4.5px)]" aria-hidden />
    if (!state) return <span className="size-2.5 shrink-0 rounded-full border-2 border-muted-foreground/50" aria-hidden />
    return <span className={cn('size-2.5 shrink-0 rounded-full', playing(f) ? 'bg-sky-400' : 'bg-win')} aria-hidden />
}

/** "Away · Riot Mobile", "In game · Party 3/5"; the game name is already the group title. */
const Status = ({ f, game }: { f: Friend; game: boolean }) => {
    const { t } = useTranslation()
    const parts = [
        f.state === 'away' && t('chat.away'),
        !game && f.product && (PRODUCTS[f.product] ?? f.product),
        f.activity && t(`chat.activity.${f.activity}`),
        f.queue && (f.queue.startsWith('lol:') ? LOL_QUEUES.has(f.queue.slice(4)) && t(`chat.lolQueues.${f.queue.slice(4)}`) : queueLabel(t, { id: f.queue })),
        f.party && t('chat.party', { size: f.party[0], max: f.party[1] })
    ].filter(Boolean)
    if (!parts.length) return null
    return <span className="block truncate text-[0.6875rem] text-muted-foreground">{parts.join(' · ')}</span>
}

/** Per-friend window: `chat` (messages) or `career` (rank + recent matches). */
const open = (kind: 'chat' | 'career', f: Friend) => void invoke('overlay_open', { id: `${kind}-${f.puuid}`, title: `${f.gameName}#${f.gameTag}` })

const Row = ({ f, unread, game }: { f: Friend; unread: number; game: boolean }) => (
    <li>
        <button
            type="button"
            onDoubleClick={() => open('chat', f)}
            onContextMenu={(e) => {
                e.preventDefault()
                open('career', f)
            }}
            className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-white/6"
        >
            <StatusIcon f={f} />
            <span className="min-w-0 flex-1">
                <span className={cn('block truncate text-sm', !f.state && 'text-muted-foreground')}>
                    {f.gameName}
                    <span className="ml-1 text-xs text-muted-foreground">#{f.gameTag}</span>
                </span>
                {f.state && <Status f={f} game={game} />}
            </span>
            {unread > 0 && <span className="rounded-full bg-primary px-1.5 text-[0.6875rem] font-semibold text-white tabular-nums">{unread}</span>}
        </button>
    </li>
)

/** Riot friends with presence and unread counts; a click opens a chat window per friend. */
export const FriendsPanel = ({ active }: { active: boolean }) => {
    const { t } = useTranslation()
    const friends = useFriends(active)
    const messages = useMessages(null, active && !!friends.data)
    const { refetch } = friends

    // Shown again (maybe after switching Riot accounts): don't wait for the next poll.
    useEffect(() => {
        if (active) void refetch()
    }, [active, refetch])
    useEffect(() => {
        const off = listen('overlay://session', () => void refetch())
        return () => void off.then((f) => f())
    }, [refetch])

    // A failed refresh would otherwise keep showing the previous account's list.
    if (!friends.data || friends.isError) return <p className="p-2 text-xs text-muted-foreground">{t('chat.notRunning')}</p>

    const unread = unreadCounts(messages.data ?? [], friends.data.me)
    const sorted = [...friends.data.friends].sort((a, b) => (unread.get(b.pid) ?? 0) - (unread.get(a.pid) ?? 0) || (ORDER[a.state ?? ''] ?? 3) - (ORDER[b.state ?? ''] ?? 3) || a.gameName.localeCompare(b.gameName))
    const present = new Set(sorted.map(groupOf))
    const keys = [...GAMES, ...[...present].filter((k) => !GAMES.includes(k) && k !== 'online' && k !== 'offline'), 'online', 'offline']
    const groups = keys.map((key) => ({ key, title: key === 'online' || key === 'offline' ? t(`chat.${key}`) : (PRODUCTS[key] ?? key), list: sorted.filter((f) => groupOf(f) === key) }))

    if (!sorted.length) return <p className="p-2 text-xs text-muted-foreground">{t('chat.noFriends')}</p>
    return (
        <div className="flex flex-col gap-2">
            <p className="px-1 text-[0.6875rem] text-muted-foreground">{t('chat.hint')}</p>
            {groups.map(
                (g) =>
                    g.list.length > 0 && (
                        <section key={g.key}>
                            <h2 className="mb-0.5 px-1 text-[0.6875rem] font-semibold text-muted-foreground uppercase">
                                {g.title} <span className="tabular-nums">({g.list.length})</span>
                            </h2>
                            <ul className="flex flex-col">
                                {g.list.map((f) => (
                                    <Row key={f.puuid} f={f} unread={unread.get(f.pid) ?? 0} game={g.key !== 'online' && g.key !== 'offline'} />
                                ))}
                            </ul>
                        </section>
                    )
            )}
        </div>
    )
}
