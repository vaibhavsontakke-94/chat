import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from './Button'

export interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ui] Unhandled error in component tree', error, info)
  }

  private reset = (): void => {
    this.setState({ error: null })
  }

  override render(): ReactNode {
    const { error } = this.state
    const { children, fallback } = this.props

    if (!error) return children
    if (fallback) return fallback(error, this.reset)

    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-danger-soft text-danger">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </div>
          <h2 className="text-base font-semibold text-ink">Something broke</h2>
          <p className="mt-2 text-sm text-ink-muted">
            The interface hit an unexpected error. Reloading the view usually fixes it.
          </p>
          {error.message ? (
            <pre className="mt-4 max-h-32 overflow-auto rounded-xl border border-line bg-canvas-raised p-3 text-left font-mono text-[11px] text-ink-subtle">
              {error.message}
            </pre>
          ) : null}
          <Button
            variant="secondary"
            className="mt-5"
            leadingIcon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={this.reset}
          >
            Try again
          </Button>
        </div>
      </div>
    )
  }
}
