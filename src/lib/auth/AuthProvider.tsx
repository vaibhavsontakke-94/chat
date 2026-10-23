import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { createElement } from 'react'
import { supabase, isAuthEnabled } from './supabaseClient'

interface AuthContextValue {
  enabled: boolean
  loading: boolean
  user: User | null
  session: Session | null
  error: string | null
  getAccessToken: () => string | null
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

interface SessionResult {
  session: Session | null
  error: string | null
}

let anonymousSignInPromise: Promise<SessionResult> | null = null

function sessionErrorMessage(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('anonymous') && lower.includes('disabled')) {
    return 'Anonymous sessions are disabled. Enable Anonymous Sign-ins in Supabase Auth, then reload.'
  }
  if (lower.includes('captcha')) {
    return 'Anonymous sign-in requires a CAPTCHA. Disable CAPTCHA for anonymous sign-ins in Supabase Auth.'
  }
  return 'Could not start a private session. Check Supabase Auth settings and reload.'
}

function ensureAnonymousSession(): Promise<SessionResult> {
  if (!supabase) {
    return Promise.resolve({
      session: null,
      error: 'Authentication is not configured on this deployment.',
    })
  }
  if (anonymousSignInPromise) return anonymousSignInPromise

  anonymousSignInPromise = (async () => {
    const { data: existing, error: getError } = await supabase.auth.getSession()
    if (getError) {
      return { session: null, error: sessionErrorMessage(getError.message) }
    }
    if (existing.session) {
      return { session: existing.session, error: null }
    }

    const { data, error } = await supabase.auth.signInAnonymously()
    if (error) {
      return { session: null, error: sessionErrorMessage(error.message) }
    }
    return { session: data.session, error: null }
  })().finally(() => {
    anonymousSignInPromise = null
  })

  return anonymousSignInPromise
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(isAuthEnabled())
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) return

    let mounted = true
    const apply = (nextSession: Session) => {
      if (!mounted) return
      setSession(nextSession)
      setUser(nextSession.user)
      setError(null)
      setLoading(false)
    }

    const init = async () => {
      try {
        const result = await ensureAnonymousSession()
        if (!mounted) return
        if (result.error) {
          setError(result.error)
          setLoading(false)
          return
        }
        if (result.session) apply(result.session)
      } catch {
        if (!mounted) return
        setError('Could not connect to Supabase Auth. Reload to try again.')
        setLoading(false)
      }
    }

    void init()

    const { data: sub } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (nextSession) apply(nextSession)
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const getAccessToken = useCallback(() => session?.access_token ?? null, [session])

  const value = useMemo<AuthContextValue>(
    () => ({
      enabled: isAuthEnabled(),
      loading,
      user,
      session,
      error,
      getAccessToken,
    }),
    [loading, user, session, error, getAccessToken],
  )

  return createElement(AuthContext.Provider, { value }, children)
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
