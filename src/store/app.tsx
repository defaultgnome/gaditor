import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react'
import type { Lang, Recipe } from '../model/types'
import { translator, type Translate } from '../i18n'
import {
  emptyOverlay,
  loadOverlay,
  mergeLibrary,
  migrateBundle,
  saveOverlay,
  type Overlay,
} from './storage'
import { loadPrefs, resolveTheme, savePrefs, type Prefs, type ThemeChoice } from './prefs'

type Status = 'loading' | 'ready' | 'error'

type State = {
  status: Status
  /** the published bundle, refetched on every load (§7.1) */
  base: Recipe[]
  overlay: Overlay
  prefs: Prefs
}

type Action =
  | { type: 'loaded'; recipes: Recipe[] }
  | { type: 'loadFailed' }
  | { type: 'setLang'; lang: Lang }
  | { type: 'setTheme'; theme: ThemeChoice }
  | { type: 'upsert'; recipe: Recipe }
  | { type: 'revert'; id: string }
  | { type: 'remove'; id: string }
  | { type: 'importRecipes'; recipes: Recipe[] }
  | { type: 'revertAll' }

const initialState: State = {
  status: 'loading',
  base: [],
  overlay: emptyOverlay(),
  prefs: { lang: 'en', theme: 'system' },
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'loaded':
      return { ...state, status: 'ready', base: action.recipes }
    case 'loadFailed':
      return { ...state, status: 'error' }
    case 'setLang':
      return { ...state, prefs: { ...state.prefs, lang: action.lang } }
    case 'setTheme':
      return { ...state, prefs: { ...state.prefs, theme: action.theme } }
    case 'upsert': {
      const recipes = { ...state.overlay.recipes, [action.recipe.id]: action.recipe }
      const tombstones = state.overlay.tombstones.filter((t) => t !== action.recipe.id)
      return { ...state, overlay: { ...state.overlay, recipes, tombstones } }
    }
    case 'revert': {
      const recipes = { ...state.overlay.recipes }
      delete recipes[action.id]
      return {
        ...state,
        overlay: {
          ...state.overlay,
          recipes,
          tombstones: state.overlay.tombstones.filter((t) => t !== action.id),
        },
      }
    }
    case 'remove': {
      const recipes = { ...state.overlay.recipes }
      delete recipes[action.id]
      const published = state.base.some((r) => r.id === action.id)
      const tombstones = published
        ? [...new Set([...state.overlay.tombstones, action.id])]
        : state.overlay.tombstones
      return { ...state, overlay: { ...state.overlay, recipes, tombstones } }
    }
    case 'importRecipes': {
      const recipes = { ...state.overlay.recipes }
      for (const r of action.recipes) recipes[r.id] = r
      const ids = new Set(action.recipes.map((r) => r.id))
      return {
        ...state,
        overlay: {
          ...state.overlay,
          recipes,
          tombstones: state.overlay.tombstones.filter((t) => !ids.has(t)),
        },
      }
    }
    case 'revertAll':
      return { ...state, overlay: emptyOverlay() }
  }
}

type AppContextValue = {
  state: State
  dispatch: (a: Action) => void
  /** base ∪ overlay, local wins (§7.2) */
  library: Recipe[]
  t: Translate
  lang: Lang
  theme: 'light' | 'dark'
}

const AppContext = createContext<AppContextValue | null>(null)

const BUNDLE_URL = `${import.meta.env.BASE_URL}recipes.json`

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState, (s) => ({
    ...s,
    overlay: loadOverlay(),
    prefs: loadPrefs(),
  }))

  useEffect(() => {
    let cancelled = false
    fetch(BUNDLE_URL, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json) => {
        if (!cancelled) dispatch({ type: 'loaded', recipes: migrateBundle(json).recipes })
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'loadFailed' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    saveOverlay(state.overlay)
  }, [state.overlay])

  useEffect(() => {
    savePrefs(state.prefs)
  }, [state.prefs])

  const theme = useThemeSideEffect(state.prefs.theme)

  useEffect(() => {
    document.documentElement.lang = state.prefs.lang
  }, [state.prefs.lang])

  const value = useMemo<AppContextValue>(() => {
    const t = translator(state.prefs.lang)
    return {
      state,
      dispatch,
      library: mergeLibrary(state.base, state.overlay),
      t,
      lang: state.prefs.lang,
      theme,
    }
  }, [state, theme])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

function useThemeSideEffect(choice: ThemeChoice): 'light' | 'dark' {
  const [, force] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (choice !== 'system' || typeof matchMedia === 'undefined') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => force()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [choice])
  const theme = resolveTheme(choice)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#12100e' : '#faf7f2')
  }, [theme])
  return theme
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp outside AppProvider')
  return ctx
}
