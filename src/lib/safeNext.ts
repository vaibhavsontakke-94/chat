/** Only allow same-origin, absolute paths to prevent open redirects. */
export function safeNext(value: string | null, fallback = '/'): string {
  if (!value) return fallback
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback

  try {
    const origin = 'http://localhost'
    const parsed = new URL(value, origin)
    if (parsed.origin !== origin) return fallback
    if (!parsed.pathname.startsWith('/') || parsed.pathname.startsWith('//')) return fallback
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}
