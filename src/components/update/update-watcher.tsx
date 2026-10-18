import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useUpdate } from '@/stores/update'

let checked = false

/** Checks once on startup (not in dev) and keeps a toast up if an update exists. */
export const UpdateWatcher = () => {
    const { t } = useTranslation()
    useEffect(() => {
        if (import.meta.env.DEV || checked) return
        checked = true
        void useUpdate
            .getState()
            .check()
            .then((u) => {
                if (u) toast(t('update.available', { v: u.version }), { duration: Infinity, action: { label: t('update.install'), onClick: () => void useUpdate.getState().install() } })
            })
    }, [t])
    return null
}
