import { useEffect, useState } from 'react'

/** Same breakpoint as the .topbar-menu / mobile layout switch in styles.css. */
const QUERY = '(max-width: 640px)'

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia(QUERY).matches,
  )

  useEffect(() => {
    if (typeof matchMedia === 'undefined') return
    const mq = matchMedia(QUERY)
    const onChange = () => setIsMobile(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return isMobile
}
