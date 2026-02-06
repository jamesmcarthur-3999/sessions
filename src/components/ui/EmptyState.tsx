interface EmptyStateProps {
  /** Primary message */
  message: string
  /** Secondary description */
  description?: string
}

export function EmptyState({ message, description }: EmptyStateProps) {
  return (
    <div className="text-center py-16">
      <p className="text-[var(--ink-muted)]">{message}</p>
      {description && (
        <p className="text-sm text-[var(--ink-muted)] mt-1">
          {description}
        </p>
      )}
    </div>
  )
}
