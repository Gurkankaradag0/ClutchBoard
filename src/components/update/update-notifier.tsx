import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useUpdate } from '@/stores/update'

// The splash checks on startup; this covers an app left running (e.g. in the tray).
const CHECK_EVERY_MS = 30 * 60_000

/** Checks for updates periodically and keeps a toast up once per new version. */
export const UpdateNotifier = () => {
    const { t } = useTranslation()
    useEffect(() => {
        if (import.meta.env.DEV) return
        let shown: string | null = null
        const id = setInterval(() => {
            // Don't interrupt a download started from Settings.
            if (useUpdate.getState().status === 'downloading') return
            void useUpdate
                .getState()
                .check()
                .then((u) => {
                    if (!u || u.version === shown) return
                    shown = u.version
                    toast(t('update.available', { v: u.version }), {
                        id: 'update',
                        duration: Infinity,
                        action: { label: t('update.install'), onClick: () => void useUpdate.getState().install() }
                    })
                })
        }, CHECK_EVERY_MS)
        return () => clearInterval(id)
    }, [t])
    return null
}
