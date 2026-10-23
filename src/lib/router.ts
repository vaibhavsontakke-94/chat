import { useEffect, useState } from 'react'
import { safeNext } from './safeNext'

export { safeNext }

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (typeof window === 'undefined') return
  if (options.replace) window.history.replaceState(null, '', to)
  else window.history.pushState(null, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function usePathname(): string {
  const [pathname, setPathname] = useState(() =>
    typeof window === 'undefined' ? '/' : window.location.pathname,
  )

  useEffect(() => {
    const onChange = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', onChange)
    return () => window.removeEventListener('popstate', onChange)
  }, [])

  return pathname
}


export function readNextParam(pathname: string): string {
  if (typeof window === 'undefined') return '/'
  void pathname
  return safeNext(new URLSearchParams(window.location.search).get('next'))
}
