import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, Outlet, useOutletContext, useParams, useSearchParams } from 'react-router'
import { Radio, RefreshCw, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/error-state'
import { RankBadge, TierName } from '@/components/rank-badge'
import { MODES, useAccount, useMmr, type Account, type Mmr, type Mode } from '@/lib/api'
import { img, useTitle } from '@/lib/assets'
import { cn } from '@/lib/utils'
import { useRecent } from '@/stores/recent'
import { useLiveOf, useLocalStatus } from '@/lib/local'

export type ProfileCtx = { account: Account; mmr: Mmr | undefined; mmrLoading: boolean; rev: number; mode: Mode }
export const useProfile = () => useOutletContext<ProfileCtx>()

const ModeSelect = ({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) => {
    const { t } = useTranslation()
    return (
        <Select value={mode || 'all'} onValueChange={(v) => onChange(v === 'all' ? '' : (v as Mode))}>
            <SelectTrigger size="sm" className="w-44" aria-label={t('modes.all')}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {MODES.map((m) => (
                    <SelectItem key={m || 'all'} value={m || 'all'}>
                        {t(`modes.${m || 'all'}`)}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

/** Shows when the player is in a match. Hidden if Riot refuses the lookup. */
const LiveBadge = ({ account }: { account: Account }) => {
    const { t } = useTranslation()
    const { data: local } = useLocalStatus()
    const { data: live } = useLiveOf(account.puuid, !!local)
    if (!live) return null
    const to = local?.puuid === account.puuid ? '/live' : `/live?of=${account.puuid}&name=${encodeURIComponent(`${account.name}#${account.tag}`)}`
    return (
        <Button asChild size="sm" className="font-display tracking-wider uppercase">
            <Link to={to}>
                <span className="relative flex size-2" aria-hidden>
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary-foreground opacity-75" />
                    <span className="relative inline-flex size-2 rounded-full bg-primary-foreground" />
                </span>
                <Radio className="size-4" />
                {t('local.liveBadge')}
            </Link>
        </Button>
    )
}

const Header = ({ account, mmr, mmrLoading, onRefresh, refreshing }: { account: Account; mmr: Mmr | undefined; mmrLoading: boolean; onRefresh: () => void; refreshing: boolean }) => {
    const { t } = useTranslation()
    const { data: title } = useTitle(account.title)
    const fav = useRecent((s) => s.entries.find((e) => e.puuid === account.puuid)?.favorite ?? false)
    const toggleFavorite = useRecent((s) => s.toggleFavorite)
    const cur = mmr?.current

    return (
        <div className="relative overflow-hidden border-b">
            <img src={img.cardWide(account.card)} alt="" className="absolute inset-0 size-full object-cover opacity-25" />
            <div className="absolute inset-0 bg-linear-to-r from-background via-background/85 to-background/40" />
            <div className="relative flex flex-wrap items-end gap-6 px-8 pt-8 pb-6">
                <img src={img.cardSmall(account.card)} alt="" className="size-24 rounded-md border-2 border-border shadow-lg" />
                <div className="min-w-0 flex-1">
                    {title?.titleText && <p className="mb-1 text-xs font-semibold tracking-widest text-gold uppercase">{title.titleText}</p>}
                    <h1 className="truncate text-4xl font-bold">
                        {account.name}
                        <span className="ml-2 text-2xl text-muted-foreground">#{account.tag}</span>
                    </h1>
                    <p className="mt-1 flex gap-3 text-sm text-muted-foreground">
                        <span>{t('profile.level', { n: account.account_level })}</span>
                        <span className="uppercase">{account.region}</span>
                    </p>
                </div>
                <div className="flex items-center gap-5">
                    {mmrLoading ? (
                        <Skeleton className="h-20 w-56" />
                    ) : (
                        cur && (
                            <div className="flex items-center gap-3">
                                <RankBadge tier={cur.tier.id} fallbackName={cur.tier.name} size="lg" showName={false} />
                                <div>
                                    <p className="text-xs text-muted-foreground uppercase">{t('profile.current')}</p>
                                    <TierName tier={cur.tier.id} fallbackName={cur.tier.name} className="text-lg" />
                                    <p className="text-sm tabular-nums">
                                        {cur.tier.id >= 3 ? t('profile.rr', { n: cur.rr }) : cur.games_needed_for_rating > 0 ? t('profile.needGames', { n: cur.games_needed_for_rating }) : t('profile.unrated')}
                                        {cur.leaderboard_placement && <span className="ml-2 text-gold">{t('profile.leaderboard', { n: cur.leaderboard_placement.rank })}</span>}
                                    </p>
                                </div>
                            </div>
                        )
                    )}
                    <div className="flex items-center gap-1">
                        <LiveBadge account={account} />
                        <Button variant="ghost" size="icon" onClick={() => toggleFavorite(account.puuid)} aria-pressed={fav} aria-label={fav ? t('search.unfavorite') : t('search.favorite')}>
                            <Star className={cn('size-5', fav && 'fill-gold text-gold')} />
                        </Button>
                        <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
                            <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
                            {t('profile.refresh')}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}

const tabClass = ({ isActive }: { isActive: boolean }) =>
    cn('relative px-1 py-3 font-display text-sm font-semibold tracking-wider text-muted-foreground uppercase transition-colors hover:text-foreground', isActive && 'text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary')

const ProfileLayout = () => {
    const { t } = useTranslation()
    const { name = '', tag = '' } = useParams()
    const [params, setParams] = useSearchParams()
    const rawMode = params.get('mode') ?? 'competitive'
    const mode: Mode = rawMode === 'all' ? '' : (MODES.find((m) => m === rawMode) ?? 'competitive')
    const [rev, setRev] = useState(0)

    const account = useAccount(name, tag, rev)
    const mmr = useMmr(account.data?.region, account.data?.puuid, rev)
    const remember = useRecent((s) => s.remember)
    const patch = useRecent((s) => s.patch)

    // Reset on profile change so a new profile isn't fetched fresh.
    useEffect(() => {
        setRev(0)
    }, [name, tag])

    useEffect(() => {
        const a = account.data
        if (a) remember({ name: a.name, tag: a.tag, puuid: a.puuid, region: a.region, card: a.card, level: a.account_level })
    }, [account.data, remember])

    useEffect(() => {
        const cur = mmr.data?.current
        if (cur && account.data) patch(account.data.puuid, { tier: cur.tier.id, tierName: cur.tier.name })
    }, [mmr.data, account.data, patch])

    if (account.isPending) {
        return (
            <div className="flex items-end gap-6 border-b px-8 pt-8 pb-6">
                <Skeleton className="size-24" />
                <div className="flex flex-col gap-2">
                    <Skeleton className="h-10 w-72" />
                    <Skeleton className="h-4 w-32" />
                </div>
            </div>
        )
    }
    if (account.isError) {
        return (
            <div className="p-8">
                <ErrorState error={account.error} onRetry={() => void account.refetch()} />
            </div>
        )
    }

    const ctx: ProfileCtx = { account: account.data, mmr: mmr.data, mmrLoading: mmr.isPending, rev, mode }
    return (
        <div>
            <Header account={account.data} mmr={mmr.data} mmrLoading={mmr.isPending} onRefresh={() => setRev((r) => r + 1)} refreshing={account.isFetching || mmr.isFetching} />
            <div className="sticky top-0 z-20 flex items-center gap-6 border-b bg-background/95 px-8 backdrop-blur">
                <NavLink to={{ pathname: '.', search: params.toString() }} end className={tabClass}>
                    {t('profile.overview')}
                </NavLink>
                <NavLink to={{ pathname: 'matches', search: params.toString() }} className={tabClass}>
                    {t('profile.matches')}
                </NavLink>
                <NavLink to={{ pathname: 'players', search: params.toString() }} className={tabClass}>
                    {t('mates.tab')}
                </NavLink>
                <div className="ml-auto">
                    <ModeSelect
                        mode={mode}
                        onChange={(m) =>
                            setParams((p) => {
                                p.set('mode', m || 'all')
                                return p
                            })
                        }
                    />
                </div>
            </div>
            <div className="px-8 py-6">
                <Outlet context={ctx} />
            </div>
        </div>
    )
}

export default ProfileLayout
