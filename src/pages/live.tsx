import { useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'
import { EyeOff, LayoutGrid, Loader2, RefreshCw, ScanSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { RankBadge } from '@/components/rank-badge'
import { SkinTile } from '@/components/local/skin-tile'
import { LoadoutView } from '@/components/local/loadout-view'
import { profilePath } from '@/components/search/riot-id-search'
import { fetchMmr } from '@/lib/api'
import { img } from '@/lib/assets'
import { henrikRegion, liveParties, livePlayers, matchLoadouts, resolveSkin, revealName, useLiveMatch, useLocalStatus, useSkinIndex, type LivePlayer, type PlayerLoadout, type RevealedName, type SkinIndex } from '@/lib/local'
import type { Party } from '@/lib/stats'
import { cn } from '@/lib/utils'
import { LocalError, NotRunning } from './me'

// Featured weapons per row; the rest are in the "All" dialog.
const FEATURED = ['9c82e19d-4575-0200-1a81-3eacf00cf872', 'ee8e8d15-496b-07ac-e5f6-8fae5d4c7b1a', 'a03b24d3-4319-996d-0f8c-94bbfba1dfc7', 'e336c6b8-418d-9340-d77f-7a9e4cfe0702']

/** undefined: not asked, 'pending': looking up, { failed }: not found */
type Reveal = RevealedName | { failed: string[] } | 'pending' | undefined
const isName = (r: Reveal): r is RevealedName => typeof r === 'object' && 'name' in r

type RowProps = {
    p: LivePlayer
    me: boolean
    name?: { GameName: string; TagLine: string }
    reveal: Reveal
    onReveal: () => void
    party?: Party
    tier?: number
    tierName?: string
    loadout?: PlayerLoadout
    index?: SkinIndex
}

const PlayerName = ({ p, me, name, reveal, onReveal }: Pick<RowProps, 'p' | 'me' | 'name' | 'reveal' | 'onReveal'>) => {
    const { t } = useTranslation()
    const hidden = p.PlayerIdentity?.Incognito && !me
    const shown = hidden ? (isName(reveal) ? { GameName: reveal.name, TagLine: reveal.tag } : undefined) : name
    const failed = typeof reveal === 'object' && 'failed' in reveal ? reveal.failed : null
    if (shown)
        return (
            <span className="flex min-w-0 items-center gap-1.5">
                {hidden && <EyeOff className="size-3.5 shrink-0 text-muted-foreground" aria-label={t('local.hidden')} />}
                <Link to={profilePath(shown.GameName, shown.TagLine)} className="truncate font-medium hover:underline">
                    {shown.GameName}
                    <span className="ml-1 text-muted-foreground">#{shown.TagLine}</span>
                </Link>
            </span>
        )
    if (!hidden) return <span className="text-muted-foreground">—</span>
    return (
        <span className="flex items-center gap-1.5 text-muted-foreground">
            <EyeOff className="size-4" aria-hidden />
            {t('local.hidden')}
            <Tooltip>
                <TooltipTrigger asChild>
                    {/* span so the tooltip still works on a disabled button */}
                    <span tabIndex={failed ? 0 : -1}>
                        <Button variant="ghost" size="icon-xs" onClick={onReveal} disabled={reveal === 'pending' || !!failed} aria-label={t('local.reveal')}>
                            {reveal === 'pending' ? <Loader2 className="animate-spin" /> : <ScanSearch />}
                        </Button>
                    </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-72">
                    {failed ? (
                        <>
                            <p className="font-semibold">{t('local.revealFailed')}</p>
                            <p className="mt-1 text-[0.6875rem] opacity-80">{failed.join(' · ')}</p>
                        </>
                    ) : (
                        t('local.reveal')
                    )}
                </TooltipContent>
            </Tooltip>
        </span>
    )
}

const PlayerRow = (props: RowProps) => {
    const { t } = useTranslation()
    const { p, me, party, tier, tierName, loadout, index } = props
    const featured = FEATURED.map((id) => loadout?.guns.find((g) => g.weaponId === id)).filter((g) => !!g)
    const identity = p.PlayerIdentity ?? {}
    return (
        <li className={cn('flex items-center gap-4 rounded-md bg-card px-4 py-2.5', me && 'bg-accent')} style={party ? { boxShadow: `inset 4px 0 0 var(--party-${party.color})` } : undefined} title={party ? t('match.party', { n: party.size }) : undefined}>
            {p.CharacterID ? <img src={img.agent(p.CharacterID.toLowerCase())} alt="" className="size-11 shrink-0 rounded-sm" /> : <span className="size-11 shrink-0 rounded-sm bg-muted" />}
            <div className="w-56 min-w-0">
                <PlayerName {...props} />
                {!identity.HideAccountLevel && identity.AccountLevel !== undefined && <p className="text-xs text-muted-foreground">{t('profile.level', { n: identity.AccountLevel })}</p>}
            </div>
            <div className="w-36 shrink-0">{tier !== undefined && <RankBadge tier={tier} fallbackName={tierName} />}</div>
            <div className="ml-auto flex items-center gap-2">
                {index &&
                    featured.map((g) => {
                        const skin = resolveSkin(index, g)
                        return skin && <SkinTile key={g.weaponId} skin={skin} buddyLevelId={g.buddyLevelId} compact />
                    })}
                <Dialog>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <DialogTrigger asChild>
                                <Button variant="outline" className="h-14 w-14 flex-col gap-0.5 text-[0.625rem] tracking-wider uppercase" disabled={!loadout || !index} aria-label={t('local.allSkins')}>
                                    <LayoutGrid className="size-4" />
                                    {t('local.all')}
                                </Button>
                            </DialogTrigger>
                        </TooltipTrigger>
                        <TooltipContent>{t('local.allSkins')}</TooltipContent>
                    </Tooltip>
                    {loadout && index && (
                        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-6xl">
                            <DialogTitle className="sr-only">{t('local.allSkins')}</DialogTitle>
                            <DialogDescription className="sr-only">{t('local.allSkinsHint')}</DialogDescription>
                            <LoadoutView identity={identity} name={<PlayerName {...props} />} guns={loadout.guns} expressions={loadout.expressions} index={index} className="pt-4" />
                        </DialogContent>
                    )}
                </Dialog>
            </div>
        </li>
    )
}

const LivePage = () => {
    const { t } = useTranslation()
    const status = useLocalStatus(true)
    // ?of=<puuid>&name=<Name#TAG>: a searched player's match.
    const [params] = useSearchParams()
    const of = params.get('of') ?? undefined
    const q = useLiveMatch(!!status.data, of)
    const index = useSkinIndex(!!q.data)
    const [revealed, setRevealed] = useState<Record<string, Reveal>>({})

    const live = q.data
    const players = live ? livePlayers(live) : []
    const loadouts = live ? matchLoadouts(live) : new Map<string, PlayerLoadout>()
    const parties = live ? liveParties(live) : new Map<string, Party>()
    const names = new Map(live?.names?.map((n) => [n.Subject, n]))
    const region = henrikRegion(live?.region ?? 'eu')
    const isHidden = (p: LivePlayer) => p.PlayerIdentity?.Incognito && p.Subject !== live?.puuid && p.Subject !== live?.target

    // Ranks for visible players and revealed ones.
    const ranks = useQueries({
        queries: players.map((p) => ({
            queryKey: ['mmr', p.Subject, 0],
            queryFn: () => fetchMmr(region, p.Subject),
            enabled: !isHidden(p) || isName(revealed[p.Subject]),
            staleTime: 5 * 60_000,
            retry: false
        }))
    })

    const reveal = async (p: LivePlayer) => {
        setRevealed((r) => ({ ...r, [p.Subject]: 'pending' }))
        const pid = live?.parties?.[p.Subject]
        const duos = pid ? Object.entries(live?.parties ?? {}).flatMap(([puuid, other]) => (other === pid && puuid !== p.Subject ? [puuid] : [])) : []
        const result = await revealName(p.Subject, region, duos)
        setRevealed((r) => ({ ...r, [p.Subject]: result }))
    }

    if (status.isPending) return <Skeleton className="m-8 h-64" />
    if (status.isError) return <LocalError error={status.error} onRetry={() => void status.refetch()} />
    if (!status.data) return <NotRunning />

    // Teams relative to the tracked player.
    const myTeam = players.find((p) => p.Subject === (live?.target ?? live?.puuid))?.TeamID
    const teams = [...Map.groupBy(players, (p) => p.TeamID ?? '').entries()].sort(([a], [b]) => Number(b === myTeam) - Number(a === myTeam))

    return (
        <div className="mx-auto max-w-6xl px-8 py-8">
            <div className="mb-6 flex items-center gap-4">
                <div className="flex-1">
                    <h1 className="text-3xl font-bold">
                        {/* Not uppercased: lang=tr would turn i into İ */}
                        {of && <span className="mr-3">{params.get('name')}</span>}
                        <span className="uppercase">{t('nav.live')}</span>
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        {live ? t(live.phase === 'pregame' ? 'local.pregame' : 'local.ingame') : t('local.noMatch')} · {t('local.autoRefresh')}
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void q.refetch()} disabled={q.isFetching}>
                    <RefreshCw className={cn('size-4', q.isFetching && 'animate-spin')} />
                    {t('profile.refresh')}
                </Button>
            </div>
            {q.isError ? (
                <LocalError error={q.error} onRetry={() => void q.refetch()} />
            ) : q.isPending ? (
                <Skeleton className="h-96" />
            ) : !live ? (
                <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">{t('local.noMatchHint')}</p>
            ) : (
                <>
                    {teams.map(([team, ps]) => (
                        <section key={team} className="mb-6">
                            <h2 className={cn('mb-2 text-sm font-semibold uppercase', team === myTeam ? 'text-win' : 'text-loss')}>{team === myTeam ? (of ? t('local.theirTeam') : t('local.allies')) : t('local.enemies')}</h2>
                            <ul className="flex flex-col gap-1.5">
                                {ps.map((p) => {
                                    const i = players.indexOf(p)
                                    return (
                                        <PlayerRow
                                            key={p.Subject}
                                            p={p}
                                            me={p.Subject === (live.target ?? live.puuid)}
                                            name={names.get(p.Subject)}
                                            reveal={revealed[p.Subject]}
                                            onReveal={() => void reveal(p)}
                                            party={parties.get(p.Subject)}
                                            tier={ranks[i]?.data?.current.tier.id}
                                            tierName={ranks[i]?.data?.current.tier.name}
                                            loadout={loadouts.get(p.Subject)}
                                            index={index.data}
                                        />
                                    )
                                })}
                            </ul>
                        </section>
                    ))}
                    {parties.size > 0 && <p className="text-xs text-muted-foreground">{t('local.partyHint')}</p>}
                </>
            )}
        </div>
    )
}

export default LivePage
