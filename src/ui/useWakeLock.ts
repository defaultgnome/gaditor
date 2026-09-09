import { useCallback, useEffect, useRef, useState } from 'react'

type SentinelLike = {
  release: () => Promise<void>
  addEventListener: (t: string, f: () => void) => void
}

/**
 * §8 — Screen Wake Lock on the recipe view, with a toggle. Keeps the screen alive
 * mid-cook. Re-acquired when the tab comes back, since the browser drops the lock on
 * visibility change.
 */
export function useWakeLock() {
  const [enabled, setEnabled] = useState(false)
  const [supported] = useState(
    () => typeof navigator !== 'undefined' && 'wakeLock' in navigator,
  )
  const sentinel = useRef<SentinelLike | null>(null)

  const release = useCallback(() => {
    sentinel.current?.release().catch(() => {})
    sentinel.current = null
  }, [])

  const acquire = useCallback(async () => {
    if (!supported) return
    try {
      const nav = navigator as Navigator & {
        wakeLock: { request: (t: 'screen') => Promise<SentinelLike> }
      }
      sentinel.current = await nav.wakeLock.request('screen')
    } catch {
      // Denied (low battery, background tab) — the toggle simply has no effect.
    }
  }, [supported])

  useEffect(() => {
    if (enabled) void acquire()
    else release()
    return release
  }, [enabled, acquire, release])

  useEffect(() => {
    if (!enabled) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [enabled, acquire])

  return { supported, enabled, setEnabled }
}
