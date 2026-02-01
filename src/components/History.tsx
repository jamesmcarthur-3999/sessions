import { ArrowLeft, Video, MessageSquare } from 'lucide-react'
import type { Session } from '../types'

interface HistoryProps {
  onBack: () => void;
  onSessionSelect: (session: Session) => void;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

// Group sessions by date
function groupByDate(sessions: Session[]): Map<string, Session[]> {
  const groups = new Map<string, Session[]>()

  for (const session of sessions) {
    const dateKey = formatDate(session.createdAt)
    const existing = groups.get(dateKey) || []
    groups.set(dateKey, [...existing, session])
  }

  return groups
}

export function History({ onBack, onSessionSelect }: HistoryProps) {
  // TODO: Load from storage
  const sessions: Session[] = []
  const groupedSessions = groupByDate(sessions)

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-sm border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
          <h1 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">
            History
          </h1>
          <div className="w-16" /> {/* Spacer for centering */}
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-6 py-8">
        {sessions.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-neutral-400">No sessions yet</p>
            <p className="text-sm text-neutral-400 mt-1">
              Start a session or make a capture to see it here
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {Array.from(groupedSessions.entries()).map(([date, dateSessions]) => (
              <div key={date}>
                <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-3">
                  {date}
                </h2>
                <div className="space-y-2">
                  {dateSessions.map((session) => (
                    <button
                      key={session.id}
                      onClick={() => onSessionSelect(session)}
                      className="w-full flex items-center gap-4 p-4 rounded-xl
                                 border border-neutral-200 dark:border-neutral-800
                                 hover:border-neutral-300 dark:hover:border-neutral-700
                                 hover:bg-neutral-50 dark:hover:bg-neutral-900
                                 transition-colors text-left"
                    >
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center
                        ${session.type === 'session'
                          ? 'bg-red-50 dark:bg-red-950'
                          : 'bg-blue-50 dark:bg-blue-950'
                        }`}
                      >
                        {session.type === 'session' ? (
                          <Video className="w-5 h-5 text-red-600 dark:text-red-400" />
                        ) : (
                          <MessageSquare className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-neutral-900 dark:text-neutral-100 truncate">
                          {session.title}
                        </h3>
                        <p className="text-sm text-neutral-500">
                          {session.type === 'session' ? 'Session' : 'Capture'}
                          {session.duration && ` • ${formatDuration(session.duration)}`}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
