import en from './en.json'
import fr from './fr.json'
import type { Lang } from '../model/types'

/**
 * §8.1 — hand-rolled t(key, params) over two JSON dictionaries. ~120 strings; a
 * library is not worth 40 KB.
 */
const dictionaries: Record<Lang, Record<string, string>> = { en, fr }

export const LANGS: Lang[] = ['en', 'fr']

export type Translate = (key: string, params?: Record<string, string | number>) => string

export function translator(lang: Lang): Translate {
  const dict = dictionaries[lang] ?? dictionaries.en
  return (key, params) => {
    const raw = dict[key] ?? dictionaries.en[key] ?? key
    if (!params) return raw
    return raw.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
  }
}

export function detectLang(): Lang {
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en'
  return nav.toLowerCase().startsWith('fr') ? 'fr' : 'en'
}

/** BCP-47 tag for Intl formatting in the UI locale (§4.4). */
export const localeOf = (lang: Lang): string => (lang === 'fr' ? 'fr-FR' : 'en-US')
