import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Star, X } from 'lucide-react'
import { RankBadge } from '@/components/rank-badge'
import { profilePath } from '@/components/search/riot-id-search'
import { img } from '@/lib/assets'
import { timeAgo } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useRecent, type RecentEntry } from '@/stores/recent'

const Row = ({ e }: { e: RecentEntry }) => {
    const { t } = useTranslation()
    const toggleFavorite = useRecent((s) => s.toggleFavorite)
    const remove = useRecent((s) => s.remove)
    return (
        <li className="group relative flex items-center gap-3 rounded-md border border-transparent bg-card px-3 py-2.5 transition-colors hover:border-border hover:bg-accent/60">
            <img src={img.cardSmall(e.card)} alt="" className="size-10 rounded-sm" loading="lazy" />
            <Link to={profilePath(e.name, e.tag)} className="min-w-0 flex-1 after:absolute after:inset-0">
                <span className="block truncate font-medium">
                    {e.name}
                    <span className="ml-1 text-muted-foreground">#{e.tag}</span>
                </span>
                <span className="text-xs text-muted-foreground uppercase">
                    {e.region} · {timeAgo(e.at)}
                </span>
            </Link>
            {e.tier !== undefined && <RankBadge tier={e.tier} fallbackName={e.tierName} showName={false} size="md" />}
            <div className="relative z-10 flex gap-1">
                <button type="button" onClick={() => toggleFavorite(e.puuid)} aria-label={e.favorite ? t('search.unfavorite') : t('search.favorite')} aria-pressed={e.favorite} className="rounded p-1.5 text-muted-foreground hover:text-gold">
                    <Star className={cn('size-4', e.favorite && 'fill-gold text-gold')} />
                </button>
                <button type="button" onClick={() => remove(e.puuid)} aria-label={t('search.remove')} className="rounded p-1.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100">
                    <X className="size-4" />
                </button>
            </div>
        </li>
    )
}

export const RecentList = () => {
    const { t } = useTranslation()
    const entries = useRecent((s) => s.entries)
    const clear = useRecent((s) => s.clear)
    const favorites = entries.filter((e) => e.favorite)
    const recent = entries.filter((e) => !e.favorite)

    return (
        <div className="grid gap-8 lg:grid-cols-2">
            <section aria-labelledby="recent-h">
                <div className="mb-3 flex items-center justify-between">
                    <h2 id="recent-h" className="text-sm font-semibold text-muted-foreground uppercase">
                        {t('search.recent')}
                    </h2>
                    {recent.length > 0 && (
                        <button type="button" onClick={clear} className="text-xs text-muted-foreground hover:text-foreground">
                            {t('search.clear')}
                        </button>
                    )}
                </div>
                {recent.length ? (
                    <ul className="flex flex-col gap-1.5">
                        {recent.map((e) => (
                            <Row key={e.puuid} e={e} />
                        ))}
                    </ul>
                ) : (
                    <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">{t('search.emptyRecent')}</p>
                )}
            </section>
            {favorites.length > 0 && (
                <section aria-labelledby="fav-h">
                    <h2 id="fav-h" className="mb-3 text-sm font-semibold text-muted-foreground uppercase">
                        {t('search.favorites')}
                    </h2>
                    <ul className="flex flex-col gap-1.5">
                        {favorites.map((e) => (
                            <Row key={e.puuid} e={e} />
                        ))}
                    </ul>
                </section>
            )}
        </div>
    )
}
