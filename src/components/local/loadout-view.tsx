import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { img } from '@/lib/assets'
import { buddyImg, expressionImg, levelBorderImg, resolveSkin, type Equipped, type ExpressionItem, type Identity, type SkinIndex, type SkinInfo } from '@/lib/local'
import { cn } from '@/lib/utils'

// In-game buy menu columns. Melee goes under sidearms; each column is ordered by price.
const COLUMNS: string[][] = [['Sidearm', 'Melee'], ['SMG', 'Shotgun'], ['Rifle'], ['Sniper', 'Heavy']]

/** Spray/flex wheel, items spaced evenly clockwise from the top. */
const ExpressionWheel = ({ items }: { items: ExpressionItem[] }) => {
    const { t } = useTranslation()
    if (!items.length) return null
    // Item radius in %; pulled in for larger wheels so items stay inside the circle.
    const R = items.length > 4 ? 31 : 29
    return (
        <div role="img" aria-label={t('local.sprays')} className="relative size-44 shrink-0 rounded-full border border-white/15 bg-black/45 backdrop-blur-sm">
            <span className="absolute inset-1/2 size-3 -translate-1/2 rounded-full border border-white/30" aria-hidden />
            {items.map((e, i) => {
                const a = (i / items.length) * 2 * Math.PI - Math.PI / 2
                return (
                    <img
                        key={`${e.id}-${i}`}
                        src={expressionImg(e)}
                        alt=""
                        className={cn('absolute -translate-1/2 object-contain drop-shadow-[0_2px_6px_rgb(0_0_0/0.6)]', items.length > 4 ? 'size-11' : 'size-13')}
                        style={{ left: `${50 + R * Math.cos(a)}%`, top: `${50 + R * Math.sin(a)}%` }}
                        loading="lazy"
                    />
                )
            })}
        </div>
    )
}

/** Account level on top of the preferred level border. */
const LevelBadge = ({ identity }: { identity: Identity }) => {
    if (identity.HideAccountLevel || identity.AccountLevel === undefined) return null
    return (
        <span className="relative grid h-9 w-24 place-items-center">
            {identity.PreferredLevelBorderID && !identity.PreferredLevelBorderID.startsWith('00000000') && <img src={levelBorderImg(identity.PreferredLevelBorderID)} alt="" className="absolute inset-0 size-full object-contain" />}
            <span className="relative font-display text-sm font-bold tabular-nums drop-shadow-[0_1px_2px_rgb(0_0_0/0.9)]">{identity.AccountLevel}</span>
        </span>
    )
}

/** Wide player card with level, name and spray wheel. */
export const CollectionBanner = ({ identity, name, expressions }: { identity: Identity; name: ReactNode; expressions: ExpressionItem[] }) => (
    <div className="relative flex min-h-48 items-center gap-5 overflow-hidden rounded-md border bg-card p-5">
        {identity.PlayerCardID && <img src={img.cardWide(identity.PlayerCardID)} alt="" className="absolute inset-0 size-full object-cover" />}
        <div className="absolute inset-0 bg-linear-to-r from-black/80 via-black/40 to-black/60" />
        <div className="relative flex items-center gap-4">
            {identity.PlayerCardID && <img src={img.cardSmall(identity.PlayerCardID)} alt="" className="size-24 rounded-sm border-2 border-white/25 shadow-lg" />}
            <div className="flex flex-col items-start gap-1.5">
                <div className="font-display text-2xl font-bold drop-shadow">{name}</div>
                <LevelBadge identity={identity} />
            </div>
        </div>
        <div className="relative ml-auto">
            <ExpressionWheel items={expressions} />
        </div>
    </div>
)

const BuyTile = ({ skin, buddyLevelId }: { skin: SkinInfo; buddyLevelId?: string }) => (
    <figure
        className="group relative flex h-28 flex-col overflow-hidden rounded-sm border border-white/10 bg-linear-to-b from-white/6 to-white/2 p-2.5 transition-colors hover:border-white/30"
        style={{ boxShadow: skin.tierColor ? `inset 0 -2px 0 ${skin.tierColor}` : undefined }}
        title={skin.skinName}
    >
        <figcaption className="flex items-baseline justify-between text-[0.6875rem] tracking-wider text-muted-foreground uppercase">
            <span>{skin.weaponName}</span>
            {skin.cost > 0 && <span className="tabular-nums">¤ {skin.cost.toLocaleString()}</span>}
        </figcaption>
        <img src={skin.image} alt={skin.skinName} className="mx-auto min-h-0 w-full flex-1 object-contain py-1.5 transition-transform group-hover:scale-105" loading="lazy" />
        <p className="truncate text-xs font-medium">{skin.skinName}</p>
        {buddyLevelId && <img src={buddyImg(buddyLevelId)} alt="" className="absolute right-1.5 bottom-6 size-7 object-contain" loading="lazy" />}
    </figure>
)

/** All weapons in buy menu layout; unequipped ones use the default skin. */
export const BuyMenu = ({ guns, index }: { guns: Equipped[]; index: SkinIndex }) => {
    const { t } = useTranslation()
    const equipped = new Map(guns.map((g) => [g.weaponId, g]))
    const byCategory = Map.groupBy(index.order, (id) => index.weaponsById.get(id)?.category ?? '')
    return (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 lg:grid-cols-4">
            {COLUMNS.map((cats) => (
                <div key={cats.join()} className="flex flex-col gap-4">
                    {cats.map((cat) => (
                        <section key={cat} aria-label={t(`local.categories.${cat}`)}>
                            <h3 className="mb-2 border-b border-white/10 pb-1 font-display text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">{t(`local.categories.${cat}`)}</h3>
                            <div className="flex flex-col gap-2">
                                {(byCategory.get(cat) ?? []).map((id) => {
                                    const g = equipped.get(id) ?? { weaponId: id }
                                    const skin = resolveSkin(index, g)
                                    return skin && <BuyTile key={id} skin={skin} buddyLevelId={g.buddyLevelId} />
                                })}
                            </div>
                        </section>
                    ))}
                </div>
            ))}
        </div>
    )
}

/** Shared by the Live Match dialog and My Account. */
export const LoadoutView = ({ identity, name, guns, expressions, index, className }: { identity: Identity; name: ReactNode; guns: Equipped[]; expressions: ExpressionItem[]; index: SkinIndex; className?: string }) => (
    <div className={cn('flex flex-col gap-6', className)}>
        <CollectionBanner identity={identity} name={name} expressions={expressions} />
        <BuyMenu guns={guns} index={index} />
    </div>
)
