import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import type { ArchiveState } from '@/lib/archive'

/** Shown while newer matches load in the background. */
export const SyncNote = ({ a }: { a: ArchiveState }) => {
    const { t } = useTranslation()
    if (!a.syncing || !a.matches.length) return null
    return (
        <p role="status" className="mb-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            {a.found ? t('archive.found', { n: a.found }) : t('archive.syncing')}
        </p>
    )
}
