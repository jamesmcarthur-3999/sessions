import { useState } from 'react'
import { motion } from 'framer-motion'
import { Video, Feather, ChevronRight, Settings, Sparkles } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { apiKeyConfigured } from '../services/bots'
import { generateId } from '../utils/id'
import { RecordingSettings, defaultRecordingConfig, type RecordingConfig } from './RecordingSettings'
import type { Session } from '../types'

type View = 'home' | 'summary' | 'history' | 'capture' | 'recording' | 'settings'

interface HomeProps {
  onNavigate: (view: View) => void
  onSessionSelect: (session: Session) => void
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.12,
      delayChildren: 0.1,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as const },
  },
}

export function Home({ onNavigate, onSessionSelect }: HomeProps) {
  const { state, dispatch } = useApp()
  const recentSessions = state.sessions.slice(0, 5)
  const apiKeyConfigured = apiKeyConfigured()
  const [showRecordingSettings, setShowRecordingSettings] = useState(false)
  const [recordingConfig, setRecordingConfig] = useState<RecordingConfig>(defaultRecordingConfig)

  const handleOpenRecordingSettings = () => {
    setShowRecordingSettings(true)
  }

  const handleStartSession = () => {
    setShowRecordingSettings(false)
    const session: Session = {
      id: generateId(),
      type: 'session',
      title: 'New Session',
      createdAt: new Date().toISOString(),
    }
    // Store recording config in session for use by SessionRecording
    ;(session as any).recordingConfig = recordingConfig
    dispatch({ type: 'START_RECORDING', payload: session })
    onNavigate('recording')
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="min-h-screen flex flex-col bg-[var(--paper)] texture-grain"
    >
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-3 text-[var(--ink-muted)]">
          <span className="kbd">⌘</span>
          <span className="kbd">K</span>
          <span className="text-xs ml-1">to search</span>
        </div>
        <button
          onClick={() => onNavigate('settings')}
          className="flex items-center gap-2 p-2.5 rounded-lg text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--paper-warm)] transition-all duration-200"
        >
          {!apiKeyConfigured && (
            <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
          )}
          <Settings className="w-5 h-5" />
        </button>
      </header>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-32">
        {/* Greeting */}
        <motion.div variants={itemVariants} className="text-center mb-16">
          <h1 className="font-display text-5xl md:text-6xl font-light text-[var(--ink)] tracking-tight mb-4">
            {getGreeting()}
          </h1>
          {apiKeyConfigured ? (
            <p className="flex items-center justify-center gap-2 text-sm text-[var(--ink-muted)]">
              <Sparkles className="w-4 h-4 text-[var(--accent)]" />
              <span>AI-powered insights enabled</span>
            </p>
          ) : (
            <button
              onClick={() => onNavigate('settings')}
              className="text-sm text-[var(--accent)] hover:underline underline-offset-4"
            >
              Configure Claude API for intelligent summaries →
            </button>
          )}
        </motion.div>

        {/* Action cards */}
        <motion.div variants={itemVariants} className="w-full max-w-lg space-y-4">
          {/* Start Session Card */}
          <motion.button
            onClick={handleOpenRecordingSettings}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            className="w-full group"
          >
            <div className="relative p-6 rounded-xl border border-[var(--border-subtle)] bg-[var(--paper-warm)] hover:border-[var(--session-recording)] hover:shadow-[var(--shadow-lg)] transition-all duration-300 text-left overflow-hidden">
              {/* Decorative accent line */}
              <div className="absolute top-0 left-0 w-1 h-full bg-[var(--session-recording)] opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

              <div className="flex items-center gap-5">
                <div className="w-14 h-14 rounded-xl bg-[var(--session-recording-muted)] flex items-center justify-center group-hover:bg-[var(--session-recording)] transition-colors duration-300">
                  <Video className="w-6 h-6 text-[var(--session-recording)] group-hover:text-white transition-colors duration-300" />
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-medium text-[var(--ink)] mb-1">
                    Record a Session
                  </h2>
                  <p className="text-sm text-[var(--ink-muted)]">
                    Capture your screen while you work
                  </p>
                </div>
                <ChevronRight className="w-5 h-5 text-[var(--ink-muted)] group-hover:text-[var(--session-recording)] group-hover:translate-x-1 transition-all duration-300" />
              </div>
            </div>
          </motion.button>

          {/* Quick Capture Card */}
          <motion.button
            onClick={() => onNavigate('capture')}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            className="w-full group"
          >
            <div className="relative p-6 rounded-xl border border-[var(--border-subtle)] bg-[var(--paper-warm)] hover:border-[var(--session-capture)] hover:shadow-[var(--shadow-lg)] transition-all duration-300 text-left overflow-hidden">
              {/* Decorative accent line */}
              <div className="absolute top-0 left-0 w-1 h-full bg-[var(--session-capture)] opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

              <div className="flex items-center gap-5">
                <div className="w-14 h-14 rounded-xl bg-[var(--session-capture-muted)] flex items-center justify-center group-hover:bg-[var(--session-capture)] transition-colors duration-300">
                  <Feather className="w-6 h-6 text-[var(--session-capture)] group-hover:text-white transition-colors duration-300" />
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-medium text-[var(--ink)] mb-1">
                    Quick Capture
                  </h2>
                  <p className="text-sm text-[var(--ink-muted)]">
                    Write or paste to summarize
                  </p>
                </div>
                <ChevronRight className="w-5 h-5 text-[var(--ink-muted)] group-hover:text-[var(--session-capture)] group-hover:translate-x-1 transition-all duration-300" />
              </div>
            </div>
          </motion.button>
        </motion.div>
      </div>

      {/* Recent sessions */}
      {recentSessions.length > 0 && (
        <motion.div
          variants={itemVariants}
          className="border-t border-[var(--border-subtle)] px-6 py-10"
        >
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="label-section">Recent</h3>
              <button
                onClick={() => onNavigate('history')}
                className="text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors duration-200"
              >
                View all →
              </button>
            </div>
            <div className="space-y-1">
              {recentSessions.map((session, index) => (
                <motion.button
                  key={session.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05, duration: 0.3 }}
                  onClick={() => onSessionSelect(session)}
                  className="w-full flex items-center gap-4 p-4 rounded-lg hover:bg-[var(--paper-warm)] transition-all duration-200 text-left group"
                >
                  {/* Type indicator */}
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    session.type === 'session'
                      ? 'bg-[var(--session-recording-muted)]'
                      : 'bg-[var(--session-capture-muted)]'
                  }`}>
                    {session.type === 'session' ? (
                      <Video className="w-4 h-4 text-[var(--session-recording)]" />
                    ) : (
                      <Feather className="w-4 h-4 text-[var(--session-capture)]" />
                    )}
                  </div>

                  {/* Title */}
                  <span className="flex-1 text-[var(--ink)] truncate font-medium">
                    {session.title}
                  </span>

                  {/* Duration badge */}
                  {session.duration && (
                    <span className="text-xs text-[var(--ink-muted)] px-2 py-1 rounded bg-[var(--paper-dark)]">
                      {formatDuration(session.duration)}
                    </span>
                  )}

                  {/* Time */}
                  <span className="text-sm text-[var(--ink-muted)] tabular-nums">
                    {formatRelativeTime(session.createdAt)}
                  </span>
                </motion.button>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* Empty state */}
      {state.sessions.length === 0 && !state.isLoading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="fixed bottom-10 left-0 right-0 text-center"
        >
          <div className="divider-ornate max-w-xs mx-auto px-6 mb-4">
            <Sparkles className="w-4 h-4 text-[var(--accent)]" />
          </div>
          <p className="text-sm text-[var(--ink-muted)] italic font-display">
            Your sessions will appear here
          </p>
        </motion.div>
      )}

      {/* Keyboard shortcuts footer */}
      <motion.footer
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="fixed bottom-0 left-0 right-0 py-4 px-6"
      >
        <div className="flex items-center justify-center gap-6 text-xs text-[var(--ink-muted)]">
          <div className="flex items-center gap-2">
            <span className="kbd">⌘</span>
            <span className="kbd">N</span>
            <span>Capture</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="kbd">⇧</span>
            <span className="kbd">⌘</span>
            <span className="kbd">N</span>
            <span>Record</span>
          </div>
        </div>
      </motion.footer>

      {/* Recording Settings Modal */}
      <RecordingSettings
        isOpen={showRecordingSettings}
        onClose={() => setShowRecordingSettings(false)}
        config={recordingConfig}
        onConfigChange={setRecordingConfig}
        onStartRecording={handleStartSession}
      />
    </motion.div>
  )
}
