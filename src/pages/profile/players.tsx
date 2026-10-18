import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorState } from '@/components/error-state'
import { useArchive } from '@/lib/archive'
import { LoadMore, TeammatesTable } from '@/components/profile/teammates'
import { teammates } from '@/lib/stats'
import { MatchListSkeleton } from './matches'
import { useProfile } from './layout'

/** Everyone met in loaded matches; grows with "Load more". */
const PlayersPage = () => {
    const { t } = useTranslation()
    const { account, mode, rev } = useProfile()
    const q = useArchive(account.region, account.puuid, mode, rev)
    const loaded = q.matches
    const mates = useMemo(() => teammates(loaded, account.puuid), [loaded, account.puuid])

    if (q.isPending) return <MatchListSkeleton rows={6} />
    if (q.error && !loaded.length) return <ErrorState error={q.error} />

    return (
        <div className="mx-auto max-w-6xl">
            <p className="mb-3 text-sm text-muted-foreground">{t('mates.explain', { n: loaded.length })}</p>
            {mates.length ? <TeammatesTable mates={mates} /> : <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">{t('mates.empty')}</p>}
            <LoadMore a={q} />
        </div>
    )
}

export default PlayersPage
