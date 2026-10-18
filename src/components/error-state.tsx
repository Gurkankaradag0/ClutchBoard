import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isApiError } from '@/lib/api'

type Props = { error: unknown; notFound?: string; onRetry?: () => void }

export const ErrorState = ({ error, notFound, onRetry }: Props) => {
    const { t } = useTranslation()
    const e = isApiError(error) ? error : null

    const message = !e
        ? t('errors.unknown')
        : e.kind === 'noKey'
          ? t('errors.noKey')
          : e.kind === 'notFound'
            ? (notFound ?? t('errors.notFound'))
            : e.kind === 'rateLimited'
              ? t('errors.rateLimited', { n: e.retryAfter })
              : e.kind === 'http'
                ? t('errors.http', { status: e.status, message: e.message })
                : t('errors.network', { message: e.message })

    return (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-loss/30 bg-loss/8 p-4">
            <p className="flex items-center gap-2 text-sm">
                <TriangleAlert className="size-4 shrink-0 text-loss" aria-hidden />
                {message}
            </p>
            {e?.kind === 'noKey' ? (
                <Button asChild size="sm" variant="outline">
                    <Link to="/settings">{t('errors.goSettings')}</Link>
                </Button>
            ) : (
                onRetry &&
                e?.kind !== 'notFound' && (
                    <Button size="sm" variant="outline" onClick={onRetry}>
                        {t('errors.retry')}
                    </Button>
                )
            )}
        </div>
    )
}
