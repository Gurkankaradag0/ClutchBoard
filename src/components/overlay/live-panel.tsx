import { useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { EyeOff, LayoutGrid, Loader2, ScanSearch } from 'lucide-react'
import { RankBadge } from '@/components/rank-badge'
import { fetchMmr } from '@/lib/api'
import { img } from '@/lib/assets'
import { FEATURED_WEAPONS, categoryRank, henrikRegion, liveParties, livePlayers, matchLoadouts, resolveSkin, revealName, useLiveMatch, useLocalStatus, useSkinIndex, type LivePlayer, type PlayerLoadout, type RevealedName, type SkinIndex } from '@/lib/local'
import type { Party } from '@/lib/stats'
import { cn } from '@/lib/utils'

/** undefined: not asked, 'pending': looking up, { failed }: not found */
type Reveal = RevealedName | { failed: string[] } | 'pending' | undefined
const isName = (r: Reveal): r is RevealedName => typeof r === 'object' && 'name' in r

/** Per-player overlay window: `career` (rank + matches) or `inventory` (all skins). */
const open = (kind: 'career' | 'inventory', puuid: string, title: string) => void invoke('overlay_open', { id: `${kind}-${puuid}`, title })

const Skins = ({ loadout, index, all }: { loadout: PlayerLoadout; index: SkinIndex; all: boolean }) => {
    const guns = all
        ? [...loadout.guns].sort((a, b) => categoryRank(index.weaponsById.get(a.weaponId)?.category ?? '') - categoryRank(index.weaponsById.get(b.weaponId)?.category ?? ''))
        : FEATURED_WEAPONS.map((id) => loadout.guns.find((g) => g.weaponId === id)).filter((g) => !!g)
    return (
        <div className={cn('flex flex-wrap gap-1', all && 'mt-1.5 pl-9')}>
            {guns.map((g) => {
                const skin = resolveSkin(index, g)
                return (
                    skin && (
                        <div key={g.weaponId} title={`${skin.weaponName}: ${skin.skinName}`} className={cn('rounded-sm bg-white/5 px-1', all ? 'h-8 w-20' : 'h-6 w-14')} style={{ borderBottom: skin.tierColor ? `2px solid ${skin.tierColor}` : undefined }}>
                            <img src={skin.image} alt={skin.skinName} className="size-full object-contain" loading="lazy" />
                        </div>
                    )
                )
            })}
        </div>
    )
}

type RowProps = { p: LivePlayer; me: boolean; name?: { GameName: string; TagLine: string }; reveal: Reveal; onReveal: () => void; party?: Party; tier?: number; tierName?: string; loadout?: PlayerLoadout; index?: SkinIndex }

const Row = ({ p, me, name, reveal, onReveal, party, tier, tierName, loadout, index }: RowProps) => {
    const { t } = useTranslation()
    const [expanded, setExpanded] = useState(false)
    const hidden = p.PlayerIdentity?.Incognito && !me
    const shown = hidden ? (isName(reveal) ? { GameName: reveal.name, TagLine: reveal.tag } : undefined) : name
    const failed = typeof reveal === 'object' && 'failed' in reveal
    const title = shown ? `${shown.GameName}#${shown.TagLine}` : t('local.hidden')
    return (
        <li className={cn('rounded-md px-1.5 py-1', me && 'bg-white/6')} style={party ? { boxShadow: `inset 3px 0 0 var(--party-${party.color})` } : undefined}>
            <div className="flex items-center gap-2">
                {p.CharacterID ? <img src={img.agent(p.CharacterID.toLowerCase())} alt="" className="size-7 shrink-0 rounded-sm" /> : <span className="size-7 shrink-0 rounded-sm bg-muted" />}
                <span className="flex min-w-0 flex-1 items-center gap-1 text-sm">
                    {hidden && <EyeOff className="size-3.5 shrink-0 text-muted-foreground" aria-label={t('local.hidden')} />}
                    {shown ? (
                        <button type="button" onClick={() => open('career', p.Subject, title)} className="truncate text-left hover:underline" title={t('chat.career')}>
                            {shown.GameName}
                            <span className="ml-1 text-xs text-muted-foreground">#{shown.TagLine}</span>
                        </button>
                    ) : hidden ? (
                        <>
                            <span className="text-muted-foreground">{t('local.hidden')}</span>
                            <button
                                type="button"
                                onClick={onReveal}
                                disabled={reveal === 'pending' || failed}
                                className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:opacity-40"
                                title={failed ? t('local.revealFailed') : t('local.reveal')}
                                aria-label={t('local.reveal')}
                            >
                                {reveal === 'pending' ? <Loader2 className="size-3.5 animate-spin" /> : <ScanSearch className="size-3.5" />}
                            </button>
                        </>
                    ) : (
                        '—'
                    )}
                </span>
                {tier !== undefined && <RankBadge tier={tier} fallbackName={tierName} size="xs" showName={false} />}
                {loadout && index && (
                    <button type="button" onClick={() => setExpanded((o) => !o)} className="shrink-0" aria-expanded={expanded} title={t('local.allSkins')}>
                        {!expanded && <Skins loadout={loadout} index={index} all={false} />}
                    </button>
                )}
                {loadout && index && (
                    <button
                        type="button"
                        onClick={() => open('inventory', p.Subject, title)}
                        className="grid size-6 shrink-0 place-items-center rounded bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                        title={t('local.allSkins')}
                        aria-label={t('local.allSkins')}
                    >
                        <LayoutGrid className="size-3.5" />
                    </button>
                )}
            </div>
            {expanded && loadout && index && (
                <button type="button" onClick={() => setExpanded(false)} className="block w-full text-left">
                    <Skins loadout={loadout} index={index} all />
                </button>
            )}
        </li>
    )
}

/** Compact live match: ranks, parties and skins. Polls the local client while open. */
export const LivePanel = ({ active }: { active: boolean }) => {
    const { t } = useTranslation()
    const status = useLocalStatus(active)
    const q = useLiveMatch(active && !!status.data)
    const index = useSkinIndex(!!q.data)
    const [revealed, setRevealed] = useState<Record<string, Reveal>>({})
    const live = q.data
    const players = live ? livePlayers(live) : []
    const region = henrikRegion(live?.region ?? 'eu')
    const ranks = useQueries({
        queries: players.map((p) => ({
            queryKey: ['mmr', p.Subject, 0],
            queryFn: () => fetchMmr(region, p.Subject),
            enabled: !p.PlayerIdentity?.Incognito || p.Subject === live?.puuid || isName(revealed[p.Subject]),
            staleTime: 5 * 60_000,
            retry: false
        }))
    })

    // Hidden names: on request, one player at a time (same as the Live Match page).
    const reveal = async (p: LivePlayer) => {
        setRevealed((r) => ({ ...r, [p.Subject]: 'pending' }))
        const pid = live?.parties?.[p.Subject]
        const duos = pid ? Object.entries(live?.parties ?? {}).flatMap(([puuid, other]) => (other === pid && puuid !== p.Subject ? [puuid] : [])) : []
        const result = await revealName(p.Subject, region, duos)
        setRevealed((r) => ({ ...r, [p.Subject]: result }))
    }

    if (!status.data) return <p className="p-2 text-xs text-muted-foreground">{t('local.notRunningTitle')}</p>
    if (!live) return <p className="p-2 text-xs text-muted-foreground">{t('local.noMatch')}</p>

    const loadouts = matchLoadouts(live)
    const parties = liveParties(live)
    const names = new Map(live.names?.map((n) => [n.Subject, n]))
    const myTeam = players.find((p) => p.Subject === live.puuid)?.TeamID
    const teams = [...Map.groupBy(players, (p) => p.TeamID ?? '').entries()].sort(([a], [b]) => Number(b === myTeam) - Number(a === myTeam))

    return (
        <div className="flex flex-col gap-2">
            <p className="px-1 text-[0.6875rem] text-muted-foreground uppercase">{t(live.phase === 'pregame' ? 'local.pregame' : 'local.ingame')}</p>
            {teams.map(([team, ps]) => (
                <section key={team}>
                    <h2 className={cn('mb-0.5 px-1 text-[0.6875rem] font-semibold uppercase', team === myTeam ? 'text-win' : 'text-loss')}>{team === myTeam ? t('local.allies') : t('local.enemies')}</h2>
                    <ul className="flex flex-col gap-0.5">
                        {ps.map((p) => {
                            const rank = ranks[players.indexOf(p)]?.data?.current
                            return (
                                <Row
                                    key={p.Subject}
                                    p={p}
                                    me={p.Subject === live.puuid}
                                    name={names.get(p.Subject)}
                                    reveal={revealed[p.Subject]}
                                    onReveal={() => void reveal(p)}
                                    party={parties.get(p.Subject)}
                                    tier={rank?.tier.id}
                                    tierName={rank?.tier.name}
                                    loadout={loadouts.get(p.Subject)}
                                    index={index.data}
                                />
                            )
                        })}
                    </ul>
                </section>
            ))}
        </div>
    )
}
