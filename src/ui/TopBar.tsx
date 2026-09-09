import type { ReactNode } from 'react'
import { useApp } from '../store/app'
import { navigate } from '../store/router'

export function TopBar({ back, children }: { back?: string; children?: ReactNode }) {
  const { t } = useApp()
  return (
    <header className="topbar">
      {back ? (
        <button className="btn ghost" onClick={() => navigate(back)}>
          ← {t('app.back')}
        </button>
      ) : (
        <button className="brand" onClick={() => navigate('/')}>
          gaditor
          <small>{t('app.tagline')}</small>
        </button>
      )}
      <div className="spacer" />
      {children}
    </header>
  )
}

export function LangThemeControls() {
  const { t, state, dispatch } = useApp()
  return (
    <>
      <div className="seg" role="group" aria-label={t('app.language')}>
        {(['en', 'fr'] as const).map((l) => (
          <button
            key={l}
            className="btn small"
            aria-pressed={state.prefs.lang === l}
            onClick={() => dispatch({ type: 'setLang', lang: l })}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="seg" role="group" aria-label={t('app.theme')}>
        {(['system', 'light', 'dark'] as const).map((th) => (
          <button
            key={th}
            className="btn small"
            aria-pressed={state.prefs.theme === th}
            onClick={() => dispatch({ type: 'setTheme', theme: th })}
            title={t(`app.theme.${th}`)}
          >
            {th === 'system' ? '◐' : th === 'light' ? '☀' : '☾'}
          </button>
        ))}
      </div>
    </>
  )
}
