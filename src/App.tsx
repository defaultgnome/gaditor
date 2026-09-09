import { Suspense, lazy } from 'react'
import { useApp } from './store/app'
import { useRoute } from './store/router'
import { ListPage } from './pages/ListPage'
import { RecipePage } from './pages/RecipePage'
import { SettingsPage } from './pages/SettingsPage'
import { UpdateToast } from './ui/UpdateToast'

// §6.2 — code-split, so the viewer bundle ships none of the editor or React Flow.
const EditorPage = lazy(() =>
  import('./pages/EditorPage').then((m) => ({ default: m.EditorPage })),
)

export function App() {
  const { state, t } = useApp()
  const route = useRoute()

  if (state.status === 'loading') {
    return <div className="shell empty">{t('app.loading')}</div>
  }

  return (
    <>
      <div className="shell">
        {state.status === 'error' && route.name === 'list' && (
          <p className="hint" role="alert">
            {t('app.loadError')}
          </p>
        )}
        {route.name === 'list' && <ListPage route={route} />}
        {/* Keyed by id: the multiplier and done marks are per cooking session, so
            moving to another recipe must start them fresh rather than inherit. */}
        {route.name === 'recipe' && <RecipePage key={route.id} id={route.id} />}
        {route.name === 'settings' && <SettingsPage />}
        {route.name === 'editor' && (
          <Suspense fallback={<div className="empty">{t('app.loading')}</div>}>
            <EditorPage key={route.id} id={route.id} />
          </Suspense>
        )}
      </div>
      <UpdateToast />
    </>
  )
}
