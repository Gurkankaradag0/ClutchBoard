import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorState } from '@/components/error-state'
import { RecentList } from '@/components/search/recent-list'
import { RiotIdSearch } from '@/components/search/riot-id-search'
import { apiKeyStatus } from '@/lib/api'

const SearchPage = () => {
    const { t } = useTranslation()
    const { data: hasKey } = useQuery({ queryKey: ['apiKeyStatus'], queryFn: apiKeyStatus })

    return (
        <div className="mx-auto flex max-w-5xl flex-col gap-10 px-8 pt-16 pb-12">
            <div className="max-w-2xl">
                <p className="mb-2 font-display text-xs font-semibold tracking-[0.3em] text-primary uppercase">{t('app.name')}</p>
                <h1 className="text-4xl font-bold uppercase">{t('search.title')}</h1>
                <p className="mt-2 text-muted-foreground">{t('search.subtitle')}</p>
            </div>
            {hasKey === false && <ErrorState error={{ kind: 'noKey' }} />}
            <RiotIdSearch size="lg" autoFocus className="max-w-2xl" />
            <RecentList />
        </div>
    )
}

export default SearchPage
