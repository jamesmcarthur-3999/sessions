import { Component, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { logger } from '../utils/logger'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  /** Called when an error is caught - use for cleanup */
  onError?: (error: Error) => void
  /** Called when reset is clicked */
  onReset?: () => void
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('ErrorBoundary caught:', error, errorInfo)
    // Call onError callback for cleanup
    this.props.onError?.(error)
  }

  handleReset = () => {
    this.props.onReset?.()
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-[var(--paper)] p-6">
          <div className="max-w-md text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-[var(--error-muted)] flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-[var(--error)]" />
            </div>

            <h1 className="text-2xl font-semibold text-[var(--ink)] mb-2">
              Something went wrong
            </h1>

            <p className="text-[var(--ink-muted)] mb-6">
              The app encountered an unexpected error. Your data is safe.
            </p>

            {this.state.error && (
              <details className="mb-6 text-left">
                <summary className="cursor-pointer text-sm text-[var(--ink-muted)] hover:text-[var(--ink-light)]">
                  Technical details
                </summary>
                <pre className="mt-2 p-3 rounded-lg bg-[var(--paper-warm)] text-xs text-[var(--ink-muted)] overflow-auto">
                  {import.meta.env.DEV
                    ? this.state.error.message
                    : 'An unexpected error occurred. Please try again or restart the app.'}
                </pre>
              </details>
            )}

            <button
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[var(--ink)] text-[var(--paper)] font-medium hover:opacity-90 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Try again
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
