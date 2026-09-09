import type { Lang } from '../model/types'
import { detectLang } from '../i18n'
import { PREFS_KEY } from './storage'

export type ThemeChoice = 'system' | 'light' | 'dark'

export type Prefs = {
  lang: Lang
  theme: ThemeChoice
}

/**
 * §8.1 / §8 — language and theme are real preferences and persist. The multiplier and
 * done marks deliberately do not (§4.3, §4.4).
 */
export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<Prefs>
      return {
        lang: p.lang === 'fr' || p.lang === 'en' ? p.lang : detectLang(),
        theme: p.theme === 'light' || p.theme === 'dark' ? p.theme : 'system',
      }
    }
  } catch {
    // fall through to defaults
  }
  return { lang: detectLang(), theme: 'system' }
}

export function savePrefs(prefs: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // preferences are nice to have, never load-bearing
  }
}

export function resolveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice !== 'system') return choice
  if (typeof matchMedia === 'undefined') return 'light'
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
