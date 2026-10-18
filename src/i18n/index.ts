import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import tr from './locales/tr.json'

const KEY = 'clutchboard:lang'
const saved = (() => {
    try {
        return localStorage.getItem(KEY)
    } catch {
        return null
    }
})()

export const LANGS = ['tr', 'en'] as const
export type Lang = (typeof LANGS)[number]

const initial: Lang = saved === 'tr' || saved === 'en' ? saved : navigator.language.toLowerCase().startsWith('tr') ? 'tr' : 'en'

void i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, tr: { translation: tr } },
    lng: initial,
    fallbackLng: 'en',
    interpolation: { escapeValue: false }
})

i18n.on('languageChanged', (lng) => {
    document.documentElement.lang = lng
    try {
        localStorage.setItem(KEY, lng)
    } catch {
        /* storage unavailable: language applies to this session only */
    }
})
document.documentElement.lang = initial

export default i18n
