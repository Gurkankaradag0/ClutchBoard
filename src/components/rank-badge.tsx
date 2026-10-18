import { useTranslation } from 'react-i18next'
import { img, tierColor, useTiers } from '@/lib/assets'
import { cn } from '@/lib/utils'

type NameProps = { tier: number; fallbackName?: string; className?: string }

/** Localized rank name in its tier color. Tiers 0-2 are unranked. */
export const TierName = ({ tier, fallbackName, className }: NameProps) => {
    const { data: tiers } = useTiers()
    const { i18n } = useTranslation()
    const row = tiers?.get(tier)
    // Names come in uppercase; plain toLowerCase breaks Turkish I/İ.
    return (
        <span className={cn('font-display font-semibold tracking-wide whitespace-nowrap capitalize', className)} style={{ color: tier >= 3 ? tierColor(row) : undefined }}>
            {(row?.tierName ?? fallbackName ?? '').toLocaleLowerCase(i18n.language)}
        </span>
    )
}

type Props = NameProps & { size?: 'xs' | 'sm' | 'md' | 'lg'; showName?: boolean }

const SIZES = { xs: 'size-5', sm: 'size-6', md: 'size-10', lg: 'size-20' }

/** Rank icon with optional name. */
export const RankBadge = ({ tier, fallbackName, size = 'sm', showName = true, className }: Props) => {
    const { data: tiers } = useTiers()
    const name = tiers?.get(tier)?.tierName ?? fallbackName ?? ''
    return (
        <span className={cn('inline-flex items-center gap-2', className)}>
            <img src={img.tier(tier < 3 ? 0 : tier)} alt={showName ? '' : name} title={name} className={cn('shrink-0 object-contain', SIZES[size])} loading="lazy" />
            {showName && <TierName tier={tier} fallbackName={fallbackName} />}
        </span>
    )
}
