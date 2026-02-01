import { ArrowLeft, CheckCircle2, Circle, FileText, MessageSquare } from 'lucide-react'
import type { Session } from '../types'

interface SummaryViewProps {
  session: Session;
  onBack: () => void;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function SummaryView({ session, onBack }: SummaryViewProps) {
  const summary = session.summary

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-sm border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-6 py-8">
        {/* Title & Meta */}
        <div className="mb-8">
          <h1 className="text-3xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
            {session.title}
          </h1>
          <p className="text-neutral-500">
            {session.type === 'session' ? 'Session' : 'Capture'}
            {session.duration && ` • ${formatDuration(session.duration)}`}
            {' • '}{formatDate(session.createdAt)}
          </p>
        </div>

        {/* Summary */}
        {summary ? (
          <>
            {/* Summary text */}
            <section className="mb-8">
              <div className="p-6 rounded-2xl bg-neutral-50 dark:bg-neutral-900">
                <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-3">
                  Summary
                </h2>
                <p className="text-neutral-900 dark:text-neutral-100 leading-relaxed">
                  {summary.text}
                </p>
              </div>
            </section>

            {/* Tasks */}
            {summary.tasks.length > 0 && (
              <section className="mb-8">
                <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-3">
                  Tasks Extracted
                </h2>
                <div className="space-y-2">
                  {summary.tasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center gap-3 p-3 rounded-lg border border-neutral-200 dark:border-neutral-800"
                    >
                      {task.completed ? (
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                      ) : (
                        <Circle className="w-5 h-5 text-neutral-300 dark:text-neutral-600" />
                      )}
                      <span className={task.completed ? 'text-neutral-400 line-through' : 'text-neutral-900 dark:text-neutral-100'}>
                        {task.title}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Notes */}
            {summary.notes.length > 0 && (
              <section className="mb-8">
                <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-3">
                  Notes
                </h2>
                <div className="space-y-2">
                  {summary.notes.map((note) => (
                    <div
                      key={note.id}
                      className="flex items-start gap-3 p-3 rounded-lg border border-neutral-200 dark:border-neutral-800"
                    >
                      <FileText className="w-5 h-5 text-neutral-400 mt-0.5" />
                      <span className="text-neutral-900 dark:text-neutral-100">
                        {note.content}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <div className="text-center py-12 text-neutral-400">
            No summary yet. Processing...
          </div>
        )}

        {/* AI Chat */}
        <section className="mt-12 pt-8 border-t border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-2 text-neutral-400 mb-4">
            <MessageSquare className="w-4 h-4" />
            <span className="text-sm">Ask AI to take action</span>
          </div>
          <input
            type="text"
            placeholder="Create a Linear ticket for..."
            className="w-full px-4 py-3 rounded-xl border border-neutral-200 dark:border-neutral-800
                       bg-transparent text-neutral-900 dark:text-neutral-100
                       placeholder:text-neutral-400
                       focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </section>
      </main>
    </div>
  )
}
