import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'

interface PageHeaderProps {
  /** Page title displayed in the center */
  title: string
  /** Called when the back button is clicked */
  onBack: () => void
  /** Back button label (default: "Back") */
  backLabel?: string
  /** Whether the back button is disabled */
  disabled?: boolean
  /** Optional content on the right side (e.g. action buttons) */
  actions?: ReactNode
  /** Max width class for the inner container (default: "max-w-2xl") */
  maxWidth?: string
}

export function PageHeader({
  title,
  onBack,
  backLabel = 'Back',
  disabled = false,
  actions,
  maxWidth = 'max-w-2xl',
}: PageHeaderProps) {
  return (
    <header className="sticky top-0 z-10 bg-[var(--paper)]/80 backdrop-blur-sm border-b border-[var(--border-subtle)]">
      <div className={`${maxWidth} mx-auto px-6 py-4 flex items-center justify-between`}>
        <button
          onClick={onBack}
          disabled={disabled}
          className="flex items-center gap-2 text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors disabled:opacity-50"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{backLabel}</span>
        </button>
        <h1 className="text-lg font-medium text-[var(--ink)]">
          {title}
        </h1>
        {actions ?? <div className="w-16" />}
      </div>
    </header>
  )
}
