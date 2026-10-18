import { useId, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Clock, Search, Star } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { RankBadge } from '@/components/rank-badge'
import { img } from '@/lib/assets'
import { suggest, type Suggestion } from '@/lib/suggest'
import { cn } from '@/lib/utils'
import { useSeen } from '@/stores/players'
import { parseRiotId, useRecent } from '@/stores/recent'

export const profilePath = (name: string, tag: string) => `/p/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`

type Props = { size?: 'lg' | 'sm'; autoFocus?: boolean; className?: string }

/** Bolds the matched part. */
const Highlight = ({ text, q }: { text: string; q: string }) => {
    const i = q ? text.toLowerCase().indexOf(q) : -1
    if (i < 0) return <>{text}</>
    return (
        <>
            {text.slice(0, i)}
            <mark className="bg-transparent font-bold text-foreground">{text.slice(i, i + q.length)}</mark>
            {text.slice(i + q.length)}
        </>
    )
}

/** Riot ID search with autocomplete from recent searches and seen players. */
export const RiotIdSearch = ({ size = 'sm', autoFocus, className }: Props) => {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const listId = useId()
    const recent = useRecent((s) => s.entries)
    const seen = useSeen((s) => s.players)
    const [value, setValue] = useState('')
    const [error, setError] = useState(false)
    const [open, setOpen] = useState(false)
    const [active, setActive] = useState(-1)

    const suggestions = useMemo(() => suggest(value, recent, seen), [value, recent, seen])
    const qName = value.trim().toLowerCase().split('#')[0] ?? ''
    const shown = open && suggestions.length > 0

    const go = (name: string, tag: string) => {
        setValue('')
        setOpen(false)
        setActive(-1)
        navigate(profilePath(name, tag))
    }

    const submit = (e: FormEvent) => {
        e.preventDefault()
        const pick = shown ? suggestions[active] : undefined
        if (pick) return go(pick.name, pick.tag)
        const id = parseRiotId(value)
        if (!id) return setError(true)
        go(id.name, id.tag)
    }

    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape') return setOpen(false)
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
        e.preventDefault()
        setOpen(true)
        const n = suggestions.length
        if (n) setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n))
    }

    const sourceIcon = (s: Suggestion) => (s.source === 'favorite' ? <Star className="size-3.5 fill-gold text-gold" aria-hidden /> : s.source === 'recent' ? <Clock className="size-3.5 text-muted-foreground" aria-hidden /> : null)

    const lg = size === 'lg'
    return (
        <form onSubmit={submit} className={cn('relative', className)} role="search">
            <div className="flex gap-2">
                <div className="relative flex-1">
                    <Search className={cn('pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground', lg ? 'size-5' : 'size-4')} aria-hidden />
                    <Input
                        value={value}
                        autoFocus={autoFocus}
                        onChange={(e) => {
                            setValue(e.target.value)
                            setError(false)
                            setOpen(true)
                            setActive(-1)
                        }}
                        onFocus={() => setOpen(true)}
                        onBlur={() => setTimeout(() => setOpen(false), 120)}
                        onKeyDown={onKeyDown}
                        placeholder={t('search.placeholder')}
                        aria-label={t('search.placeholder')}
                        aria-invalid={error}
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={shown}
                        aria-controls={listId}
                        aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
                        spellCheck={false}
                        autoComplete="off"
                        className={cn('bg-card', lg ? 'h-14 pl-11 text-lg' : 'h-9 pl-9')}
                    />
                </div>
                {lg && (
                    <Button type="submit" className="h-14 px-8 font-display text-base tracking-wider uppercase">
                        {t('search.submit')}
                    </Button>
                )}
            </div>
            {error && <p className="mt-2 text-sm text-loss">{t('search.invalid')}</p>}
            {shown && (
                <ul id={listId} role="listbox" aria-label={t('search.suggestions')} className={cn('absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-md border bg-popover py-1 shadow-lg', lg && 'right-auto w-full max-w-2xl')}>
                    {suggestions.map((s, i) => (
                        <li
                            key={s.puuid}
                            id={`${listId}-${i}`}
                            role="option"
                            aria-selected={i === active}
                            onMouseDown={(e) => e.preventDefault()}
                            onMouseEnter={() => setActive(i)}
                            onClick={() => go(s.name, s.tag)}
                            className={cn('flex cursor-pointer items-center gap-3 px-3 py-2 text-sm', i === active && 'bg-accent')}
                        >
                            <img src={img.cardSmall(s.card)} alt="" className="size-8 shrink-0 rounded-sm" loading="lazy" />
                            <span className="min-w-0 flex-1 truncate">
                                <span className="text-muted-foreground">
                                    <Highlight text={s.name} q={qName} />
                                </span>
                                <span className="ml-1 text-muted-foreground/70">#{s.tag}</span>
                            </span>
                            {sourceIcon(s)}
                            <span className="w-8 text-right text-[0.6875rem] text-muted-foreground uppercase">{s.region}</span>
                            <span className="size-6 shrink-0">{s.tier !== undefined && s.tier > 2 && <RankBadge tier={s.tier} fallbackName={s.tierName} size="sm" showName={false} />}</span>
                        </li>
                    ))}
                </ul>
            )}
        </form>
    )
}
