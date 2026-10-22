import { LogIn, LogOut } from 'lucide-react'
import { useAuth } from '../../lib/auth/AuthProvider'
import { Button } from '../ui/Button'

export function AuthButton() {
  const { enabled, loading, user, signInWithGoogle, signOut } = useAuth()
  if (!enabled) return null
  if (loading) return <div className="h-8 w-20 animate-pulse rounded-lg bg-surface-raised" />
  if (user) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden max-w-[120px] truncate text-xs text-ink-muted sm:inline">{user.email}</span>
        <Button variant="ghost" size="sm" onClick={signOut} className="gap-1.5">
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </Button>
      </div>
    )
  }
  return (
    <Button variant="ghost" size="sm" onClick={signInWithGoogle} className="gap-1.5">
      <LogIn className="h-3.5 w-3.5" />
      Sign in with Google
    </Button>
  )
}
