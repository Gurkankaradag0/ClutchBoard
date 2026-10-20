import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { SendHorizontal } from 'lucide-react'
import { markSeen, useFriends, useMessages } from '@/lib/local'
import { clock } from '@/lib/time'
import { cn } from '@/lib/utils'

/** Direct messages with one friend (`chat-<puuid>`). Sending or Esc gives focus back to the game. */
export const ChatPanel = ({ active, id }: { active: boolean; id: string }) => {
    const { t } = useTranslation()
    const qc = useQueryClient()
    const friends = useFriends(false)
    const friend = friends.data?.friends.find((f) => f.puuid === id.slice('chat-'.length))
    const q = useMessages(friend?.pid ?? null, active && !!friend)
    const [text, setText] = useState('')
    const end = useRef<HTMLDivElement>(null)
    const messages = [...(q.data ?? [])].sort((a, b) => Number(a.time) - Number(b.time))
    const pid = friend?.pid
    const lastTime = Number(messages.at(-1)?.time ?? 0)

    useEffect(() => {
        end.current?.scrollIntoView({ block: 'end' })
        if (active && pid && lastTime) markSeen(pid, lastTime)
    }, [active, pid, lastTime])

    const send = useMutation({
        mutationFn: (message: string) => invoke<void>('local_send_message', { pid: friend!.pid, message }),
        onSuccess: () => {
            setText('')
            void qc.invalidateQueries({ queryKey: ['local', 'messages'] })
            void invoke('overlay_release')
        }
    })

    if (friends.isPending) return null
    if (!friends.data) return <p className="p-2 text-xs text-muted-foreground">{t('chat.notRunning')}</p>
    if (!friend) return <p className="p-2 text-xs text-muted-foreground">{t('chat.notFriend')}</p>

    return (
        <div className="flex h-full flex-col gap-2">
            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
                {!messages.length && <p className="m-auto text-xs text-muted-foreground">{t('chat.empty')}</p>}
                {messages.map((m) => {
                    const mine = m.puuid === friends.data!.me
                    return (
                        <div key={m.id} className={cn('max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm break-words', mine ? 'self-end bg-primary/30' : 'self-start bg-white/8')}>
                            {m.body}
                            <span className="ml-2 text-[0.625rem] text-muted-foreground tabular-nums">{clock(new Date(Number(m.time)).toISOString())}</span>
                        </div>
                    )
                })}
                <div ref={end} />
            </div>
            <form
                className="flex shrink-0 gap-1"
                onSubmit={(e) => {
                    e.preventDefault()
                    if (text.trim() && !send.isPending) send.mutate(text)
                }}
            >
                <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Escape' && void invoke('overlay_release')}
                    placeholder={t('chat.placeholder')}
                    className="h-8 min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/60"
                />
                <button type="submit" disabled={!text.trim() || send.isPending} className="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-white disabled:opacity-40" aria-label={t('chat.send')}>
                    <SendHorizontal className="size-4" />
                </button>
            </form>
            {send.isError && <p className="text-xs text-loss">{t('chat.sendFailed', { message: String(send.error) })}</p>}
        </div>
    )
}
