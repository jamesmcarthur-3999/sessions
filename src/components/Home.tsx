import { Video, MessageSquare, Clock } from 'lucide-react'
import type { Session } from '../types'

interface HomeProps {
  onNavigate: (view: 'home' | 'summary' | 'history') => void;
  onSessionSelect: (session: Session) => void;
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function Home({ onNavigate, onSessionSelect }: HomeProps) {
  // TODO: Load from storage
  const recentSessions: Session[] = []

  return (
    <div className="min-h-screen flex flex-col">
      {/* Main content - centered */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-32">
        {/* Greeting */}
        <h1 className="text-4xl font-light text-neutral-900 dark:text-neutral-100 mb-12">
          {getGreeting()}
        </h1>

        {/* Action cards */}
        <div className="w-full max-w-md space-y-4">
          {/* Start Session */}
          <button
            className="w-full p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800
                       hover:border-neutral-300 dark:hover:border-neutral-700
                       hover:bg-neutral-50 dark:hover:bg-neutral-900
                       transition-colors text-left group"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-red-50 dark:bg-red-950
                              flex items-center justify-center
                              group-hover:bg-red-100 dark:group-hover:bg-red-900 transition-colors">
                <Video className="w-6 h-6 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">
                  Start a Session
                </h2>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Record your screen and audio while you work
                </p>
              </div>
            </div>
          </button>

          {/* Quick Capture */}
          <button
            className="w-full p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800
                       hover:border-neutral-300 dark:hover:border-neutral-700
                       hover:bg-neutral-50 dark:hover:bg-neutral-900
                       transition-colors text-left group"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950
                              flex items-center justify-center
                              group-hover:bg-blue-100 dark:group-hover:bg-blue-900 transition-colors">
                <MessageSquare className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">
                  Quick Capture
                </h2>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Paste or type something to summarize
                </p>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Recent sessions - bottom section */}
      {recentSessions.length > 0 && (
        <div className="border-t border-neutral-200 dark:border-neutral-800 px-6 py-8">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
                Recent
              </h3>
              <button
                onClick={() => onNavigate('history')}
                className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                View all
              </button>
            </div>
            <div className="space-y-2">
              {recentSessions.slice(0, 3).map((session) => (
                <button
                  key={session.id}
                  onClick={() => onSessionSelect(session)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg
                             hover:bg-neutral-100 dark:hover:bg-neutral-900
                             transition-colors text-left"
                >
                  <Clock className="w-4 h-4 text-neutral-400" />
                  <span className="flex-1 text-neutral-900 dark:text-neutral-100">
                    {session.title}
                  </span>
                  <span className="text-sm text-neutral-400">
                    {session.type === 'session' ? 'Session' : 'Capture'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
