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
          <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
            <g fill="none" strokeWidth="4" strokeLinejoin="round">
              <rect x="10" y="12" width="18" height="14" rx="3" />
              <rect x="10" y="30" width="18" height="22" rx="3" />
              <rect x="32" y="12" width="22" height="40" rx="3" />
            </g>
          </svg>
          <span className="brand-text">
            gaditor
            <small>{t('app.tagline')}</small>
          </span>
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
