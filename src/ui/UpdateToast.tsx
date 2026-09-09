import { useRegisterSW } from 'virtual:pwa-register/react'
import { useApp } from '../store/app'

/**
 * §8 — updates surface as a "new version — reload" toast, not a silent swap. A recipe
 * swapping out from under you mid-cook is worse than a stale one.
 */
export function UpdateToast() {
  const { t } = useApp()
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null
  return (
    <div className="toast" role="status">
      <span>{t('app.newVersion')}</span>
      <button className="btn primary small" onClick={() => updateServiceWorker(true)}>
        {t('app.reload')}
      </button>
      <button className="btn ghost small" onClick={() => setNeedRefresh(false)}>
        {t('app.close')}
      </button>
    </div>
  )
}
