import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export interface Preferences {
  sendOnEnter: boolean
  showTimestamps: boolean
}

export interface PreferencesContextValue extends Preferences {
  setPreference: (key: keyof Preferences, value: boolean) => void
}

const STORAGE_KEY = 'chat.preferences'

const DEFAULTS: Preferences = {
  sendOnEnter: true,
  showTimestamps: true,
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null)

function readStoredPreferences(): Preferences {
  if (typeof window === 'undefined') return DEFAULTS

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<Preferences>
    return {
      sendOnEnter: typeof parsed.sendOnEnter === 'boolean' ? parsed.sendOnEnter : DEFAULTS.sendOnEnter,
      showTimestamps:
        typeof parsed.showTimestamps === 'boolean' ? parsed.showTimestamps : DEFAULTS.showTimestamps,
    }
  } catch {
    return DEFAULTS
  }
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(readStoredPreferences)

  const setPreference = useCallback((key: keyof Preferences, value: boolean) => {
    setPreferences((current) => {
      const next = { ...current, [key]: value }
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Storage can be unavailable in private mode - preferences stay in memory.
      }
      return next
    })
  }, [])

  const value = useMemo<PreferencesContextValue>(
    () => ({ ...preferences, setPreference }),
    [preferences, setPreference],
  )

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext)
  if (!context) {
    throw new Error('usePreferences must be used inside <PreferencesProvider>.')
  }
  return context
}
