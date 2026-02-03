import { motion } from 'framer-motion'
import { ArrowLeft, Video, MessageSquare, Search } from 'lucide-react'
import { useState, useMemo } from 'react'
import { useApp } from '../context/AppContext'
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
  if (diffDays < 7) return date.toLocaleDateString('en-US', { weekday: 'long' })
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

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
}

export function History({ onBack, onSessionSelect }: HistoryProps) {
  const { state } = useApp()
  const [searchQuery, setSearchQuery] = useState('')

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return state.sessions
    const query = searchQuery.toLowerCase()
    return state.sessions.filter(session =>
      session.title.toLowerCase().includes(query) ||
      session.summary?.text.toLowerCase().includes(query) ||
      session.captureText?.toLowerCase().includes(query)
    )
  }, [state.sessions, searchQuery])

  const groupedSessions = groupByDate(filteredSessions)

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="min-h-screen"
    >
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[var(--paper)]/80 backdrop-blur-sm border-b border-[var(--border-subtle)]">
        <div className="max-w-3xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={onBack}
              className="flex items-center gap-2 text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>
            <h1 className="text-lg font-medium text-[var(--ink)]">
              History
            </h1>
            <div className="w-16" />
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ink-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sessions..."
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-[var(--border-subtle)]
                         bg-[var(--paper)] text-[var(--ink)]
                         placeholder:text-[var(--ink-muted)]
                         focus:outline-none focus:ring-2 focus:ring-[var(--ink)] focus:border-transparent"
            />
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-6 py-8">
        {state.isLoading ? (
          <motion.div variants={itemVariants} className="space-y-4">
            {/* Loading skeleton */}
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse flex items-center gap-4 p-4 rounded-xl border border-[var(--border-subtle)]">
                <div className="w-10 h-10 rounded-lg bg-[var(--paper-warm)]" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/3 bg-[var(--paper-warm)] rounded" />
                  <div className="h-3 w-1/2 bg-[var(--paper-dark)] rounded" />
                </div>
              </div>
            ))}
          </motion.div>
        ) : state.sessions.length === 0 ? (
          <motion.div variants={itemVariants} className="text-center py-16">
            <p className="text-[var(--ink-muted)]">No sessions yet</p>
            <p className="text-sm text-[var(--ink-muted)] mt-1">
              Start a session or make a capture to see it here
            </p>
          </motion.div>
        ) : filteredSessions.length === 0 ? (
          <motion.div variants={itemVariants} className="text-center py-16">
            <p className="text-[var(--ink-muted)]">No results found</p>
            <p className="text-sm text-[var(--ink-muted)] mt-1">
              Try a different search term
            </p>
          </motion.div>
        ) : (
          <div className="space-y-8">
            {Array.from(groupedSessions.entries()).map(([date, dateSessions]) => (
              <motion.div key={date} variants={itemVariants}>
                <h2 className="text-xs font-semibold text-[var(--ink-muted)] uppercase tracking-wider mb-3">
                  {date}
                </h2>
                <div className="space-y-2">
                  {dateSessions.map((session) => (
                    <motion.button
                      key={session.id}
                      variants={itemVariants}
                      whileHover={{ y: -2 }}
                      onClick={() => onSessionSelect(session)}
                      className="w-full flex items-center gap-4 p-4 rounded-xl
                                 border border-[var(--border-subtle)]
                                 hover:bg-[var(--paper-warm)]
                                 transition-all text-left group"
                    >
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors
                        ${session.type === 'session'
                          ? 'bg-[var(--session-red)]/10 group-hover:bg-[var(--session-red)]/20'
                          : 'bg-[var(--capture-blue)]/10 group-hover:bg-[var(--capture-blue)]/20'
                        }`}
                      >
                        {session.type === 'session' ? (
                          <Video className="w-5 h-5 text-[var(--session-red)]" />
                        ) : (
                          <MessageSquare className="w-5 h-5 text-[var(--capture-blue)]" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-[var(--ink)] truncate">
                          {session.title}
                        </h3>
                        <p className="text-sm text-[var(--ink-muted)] truncate">
                          {session.summary?.text || (session.type === 'session' ? 'Session' : 'Capture')}
                        </p>
                      </div>
                      <div className="text-right">
                        {session.duration && (
                          <span className="text-sm text-[var(--ink-muted)] block">
                            {formatDuration(session.duration)}
                          </span>
                        )}
                        {session.summary && (
                          <span className="text-xs text-[var(--ink-muted)]">
                            {session.summary.tasks.filter(t => !t.completed).length} tasks
                          </span>
                        )}
                      </div>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </main>
    </motion.div>
  )
}
