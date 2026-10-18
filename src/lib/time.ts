import i18n from '@/i18n'

const locale = () => (i18n.language === 'tr' ? 'tr-TR' : 'en-US')

export const timeAgo = (date: string | number) => {
    const diff = (new Date(date).getTime() - Date.now()) / 1000
    const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' })
    const steps: [Intl.RelativeTimeFormatUnit, number][] = [
        ['second', 60],
        ['minute', 60],
        ['hour', 24],
        ['day', 7],
        ['week', 4.35],
        ['month', 12],
        ['year', Infinity]
    ]
    let value = diff
    for (const [unit, size] of steps) {
        if (Math.abs(value) < size) return rtf.format(Math.round(value), unit)
        value /= size
    }
    return ''
}

export const dayKey = (date: string) => new Date(date).toDateString()

export const dayLabel = (date: string) => {
    const d = new Date(date)
    const today = new Date()
    const yesterday = new Date(Date.now() - 86_400_000)
    if (d.toDateString() === today.toDateString()) return i18n.t('time.today')
    if (d.toDateString() === yesterday.toDateString()) return i18n.t('time.yesterday')
    return d.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'long' })
}

export const clock = (date: string) => new Date(date).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })

export const fullDate = (date: string) => new Date(date).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })
