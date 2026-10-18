import type { SkinInfo } from '@/lib/local'
import { buddyImg } from '@/lib/local'
import { cn } from '@/lib/utils'

type Props = { skin: SkinInfo; buddyLevelId?: string; compact?: boolean }

/** Equipped skin; bottom edge uses the rarity color. */
export const SkinTile = ({ skin, buddyLevelId, compact }: Props) => (
    <figure title={`${skin.skinName}`} className={cn('relative flex flex-col overflow-hidden rounded-md border bg-card', compact ? 'h-14 w-28 justify-center px-2' : 'h-36 p-3')} style={{ borderBottomColor: skin.tierColor, borderBottomWidth: skin.tierColor ? 2 : undefined }}>
        <img src={skin.image} alt={skin.skinName} className={cn('mx-auto object-contain', compact ? 'h-9 w-full' : 'h-20 w-full flex-1')} loading="lazy" />
        {!compact && (
            <figcaption className="mt-2 min-w-0">
                <p className="truncate text-sm font-medium">{skin.skinName}</p>
                <p className="text-[0.6875rem] text-muted-foreground uppercase">{skin.weaponName}</p>
            </figcaption>
        )}
        {buddyLevelId && <img src={buddyImg(buddyLevelId)} alt="" className={cn('absolute object-contain', compact ? 'right-1 bottom-1 size-4' : 'top-2 right-2 size-7')} loading="lazy" />}
    </figure>
)
