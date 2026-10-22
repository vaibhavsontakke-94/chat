import { useEffect, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface AppShellProps {
  sidebar: ReactNode
  header: ReactNode
  children: ReactNode
  isSidebarOpen: boolean
  onSidebarOpenChange: (open: boolean) => void
  headerRight?: ReactNode
}

export function AppShell({
  sidebar,
  header,
  children,
  isSidebarOpen,
  onSidebarOpenChange,
  headerRight,
}: AppShellProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onSidebarOpenChange(false)
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onSidebarOpenChange])

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-canvas">
      <div
        aria-hidden="true"
        onClick={() => onSidebarOpenChange(false)}
        className={cn(
          'fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200 lg:hidden',
          isSidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      <div className="fixed inset-y-0 left-0 z-50 lg:static lg:z-auto">{sidebar}</div>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">{header}</div>
          {headerRight ? <div className="mr-2 flex items-center sm:mr-4">{headerRight}</div> : null}
        </div>
        {children}
      </main>
    </div>
  )
}
