import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../store/app'
import { navigate } from '../store/router'

export function TopBar({ back, children }: { back?: string; children?: ReactNode }) {
  const { t } = useApp()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Mobile collapses `children` into a popover behind a "⋮" trigger — closes on
  // outside click or Escape so it behaves like a normal menu, not a sticky panel.
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

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
      {children && (
        <>
          <div className="topbar-actions">{children}</div>
          <div className="topbar-menu" ref={menuRef}>
            <button
              type="button"
              className="btn ghost topbar-menu-trigger"
              aria-label={t('app.menu')}
              aria-haspopup="true"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              ⋮
            </button>
            {menuOpen && (
              <div className="topbar-menu-panel" role="menu">
                {children}
              </div>
            )}
          </div>
        </>
      )}
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
