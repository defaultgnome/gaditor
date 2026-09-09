import { useCallback, useEffect, useState } from 'react'

/**
 * §8 — hash routing. GitHub Pages cannot serve SPA deep links from real paths, so the
 * whole route lives after the `#`: `#/recipe/carbonara?q=egg`.
 */
export type Route =
  | { name: 'list'; query: URLSearchParams }
  | { name: 'recipe'; id: string; query: URLSearchParams }
  | { name: 'editor'; id: string; query: URLSearchParams }
  | { name: 'settings'; query: URLSearchParams }

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/'
  const [path, search = ''] = raw.split('?')
  const query = new URLSearchParams(search)
  const parts = path.split('/').filter(Boolean)
  if (parts[0] === 'recipe' && parts[1])
    return { name: 'recipe', id: decodeURIComponent(parts[1]), query }
  if (parts[0] === 'edit' && parts[1])
    return { name: 'editor', id: decodeURIComponent(parts[1]), query }
  if (parts[0] === 'settings') return { name: 'settings', query }
  return { name: 'list', query }
}

export function buildHash(path: string, query?: URLSearchParams): string {
  const q = query?.toString()
  return `#${path}${q ? `?${q}` : ''}`
}

export function navigate(path: string, query?: URLSearchParams, replace = false) {
  const target = buildHash(path, query)
  if (replace) history.replaceState(null, '', target)
  else location.hash = target
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'))
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseHash(location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

/** Search state lives in query params so the list is deep-linkable and restores (§6.1). */
export function useQueryParam(route: Route, key: string): [string, (v: string) => void] {
  const value = route.query.get(key) ?? ''
  const set = useCallback(
    (v: string) => {
      const query = new URLSearchParams(route.query)
      if (v) query.set(key, v)
      else query.delete(key)
      const path = location.hash.replace(/^#/, '').split('?')[0] || '/'
      history.replaceState(null, '', buildHash(path, query))
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    },
    [route.query, key],
  )
  return [value, set]
}
