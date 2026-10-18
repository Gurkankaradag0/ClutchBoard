import { useTranslation } from 'react-i18next'
import { Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { LoadoutView } from '@/components/local/loadout-view'
import { useTitle } from '@/lib/assets'
import { fromPersonal, useLocalStatus, useMyLoadout, useSkinIndex } from '@/lib/local'
import { cn } from '@/lib/utils'

/** Shown while Valorant is closed; status is re-checked every 5s. */
export const NotRunning = () => {
    const { t } = useTranslation()
    return (
        <div className="mx-auto max-w-xl px-8 py-16 text-center">
            <h1 className="text-2xl font-bold uppercase">{t('local.notRunningTitle')}</h1>
            <p className="mt-2 text-muted-foreground">{t('local.notRunning')}</p>
            <p className="mt-6 inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {t('local.waiting')}
            </p>
        </div>
    )
}

/** Shows the failing step and status code. */
export const LocalError = ({ error, onRetry }: { error: unknown; onRetry: () => void }) => {
    const { t } = useTranslation()
    return (
        <div role="alert" className="m-8 flex flex-col items-start gap-3 rounded-md border border-loss/30 bg-loss/8 p-4">
            <p className="flex items-center gap-2 text-sm font-medium">
                <TriangleAlert className="size-4 shrink-0 text-loss" aria-hidden />
                {t('local.error')}
            </p>
            <code className="text-xs break-all text-muted-foreground">{String(error)}</code>
            <Button size="sm" variant="outline" onClick={onRetry}>
                {t('errors.retry')}
            </Button>
        </div>
    )
}

const MePage = () => {
    const { t } = useTranslation()
    const status = useLocalStatus(true)
    const q = useMyLoadout(!!status.data)
    const index = useSkinIndex(!!q.data)
    const identity = q.data?.loadout.Identity ?? {}
    const { data: title } = useTitle(identity.PlayerTitleID)

    if (status.isPending) return <Skeleton className="m-8 h-64" />
    if (status.isError) return <LocalError error={status.error} onRetry={() => void status.refetch()} />
    if (!status.data) return <NotRunning />

    const loadout = q.data ? fromPersonal(q.data.loadout) : null

    return (
        <div className="mx-auto max-w-6xl px-8 py-8">
            <div className="mb-6 flex items-center gap-4">
                <div className="flex-1">
                    <h1 className="text-3xl font-bold uppercase">{t('nav.me')}</h1>
                    <p className="text-sm text-muted-foreground">
                        <span className="uppercase">{status.data.region}</span> · {t('local.readOnly')}
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void q.refetch()} disabled={q.isFetching}>
                    <RefreshCw className={cn('size-4', q.isFetching && 'animate-spin')} />
                    {t('profile.refresh')}
                </Button>
            </div>
            {q.isError ? (
                <LocalError error={q.error} onRetry={() => void q.refetch()} />
            ) : q.isPending || (loadout && index.isPending) ? (
                <Skeleton className="h-150" />
            ) : !loadout || !index.data ? (
                <p className="text-muted-foreground">{t('local.loadoutUnavailable')}</p>
            ) : (
                <LoadoutView identity={identity} name={title?.titleText ?? t('nav.me')} guns={loadout.guns} expressions={loadout.expressions} index={index.data} />
            )}
        </div>
    )
}

export default MePage
