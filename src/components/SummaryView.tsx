import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Send,
  Video,
  Feather,
  Paperclip,
  Trash2,
  MoreHorizontal,
  AlertCircle,
  X,
  Sparkles,
  BookOpen,
  ListChecks,
  StickyNote,
  FileText,
  Mic,
  Camera,
  Check,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { ScreenshotGallery } from './ScreenshotGallery'
import { TranscriptViewer } from './TranscriptViewer'
import { TypingIndicator } from './TypingIndicator'
import { getScreenshots, getAudioChunks } from '../services/database'
import { isTauri } from '../services/recording'
import { useSessionChat } from '../hooks/useSessionChat'
import type { Session } from '../types'
import type { DbScreenshot, DbAudioChunk } from '../types/database'

interface SummaryViewProps {
  session: Session
  onBack: () => void
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
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`
}

function getAttachmentIcon(type: 'image' | 'audio' | 'video' | 'file') {
  if (type === 'image') return Camera
  if (type === 'video') return Video
  if (type === 'audio') return Mic
  return FileText
}

// Typewriter effect component
function TypewriterText({ text, onComplete }: { text: string; onComplete?: () => void }) {
  const [displayText, setDisplayText] = useState('')
  const [isComplete, setIsComplete] = useState(false)

  useEffect(() => {
    if (isComplete) return

    let index = 0
    const interval = setInterval(() => {
      if (index < text.length) {
        setDisplayText(text.slice(0, index + 1))
        index++
      } else {
        clearInterval(interval)
        setIsComplete(true)
        onComplete?.()
      }
    }, 20)

    return () => clearInterval(interval)
  }, [text, isComplete, onComplete])

  return (
    <span>
      {displayText}
      {!isComplete && <span className="typewriter-cursor" />}
    </span>
  )
}

export function SummaryView({ session, onBack }: SummaryViewProps) {
  const { updateSession, deleteSession } = useApp()
  const [chatInput, setChatInput] = useState('')
  const {
    messages: chatMessages,
    isSending,
    error: chatError,
    sendMessage,
    clearError,
  } = useSessionChat(session.id)
  const [showMenu, setShowMenu] = useState(false)
  const [showTypewriter, setShowTypewriter] = useState(true)
  const [screenshots, setScreenshots] = useState<DbScreenshot[]>([])
  const [audioChunks, setAudioChunks] = useState<DbAudioChunk[]>([])
  const [loadingMedia, setLoadingMedia] = useState(true)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editedTitle, setEditedTitle] = useState(session.title)
  const [showSaved, setShowSaved] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [openError, setOpenError] = useState<string | null>(null)

  // Show "Saved" indicator briefly when session has summary
  useEffect(() => {
    if (session?.id && session.summary) {
      setShowSaved(true)
      const timer = setTimeout(() => setShowSaved(false), 2000)
      return () => clearTimeout(timer)
    }
  }, [session?.id, session?.summary])

  // Load screenshots and audio chunks for sessions
  useEffect(() => {
    const loadMedia = async () => {
      if (session.type !== 'session') {
        setLoadingMedia(false)
        return
      }

      setLoadingMedia(true)
      setMediaError(null)

      try {
        const [ss, audio] = await Promise.all([
          getScreenshots(session.id),
          getAudioChunks(session.id),
        ])
        setScreenshots(ss)
        setAudioChunks(audio)
      } catch (error) {
        console.error('Failed to load media:', error)
        setMediaError('Failed to load screenshots and audio. Please try again.')
      } finally {
        setLoadingMedia(false)
      }
    }

    loadMedia()
  }, [session.id, session.type])

  const summary = session.summary
  const completedTasks = summary?.tasks.filter(t => t.completed).length ?? 0
  const totalTasks = summary?.tasks.length ?? 0
  const allTasksComplete = totalTasks > 0 && completedTasks === totalTasks

  const handleToggleTask = async (taskId: string) => {
    if (!summary) return

    const updatedTasks = summary.tasks.map((task) =>
      task.id === taskId ? { ...task, completed: !task.completed } : task
    )

    const updatedSession: Session = {
      ...session,
      summary: { ...summary, tasks: updatedTasks },
    }

    await updateSession(updatedSession)
  }

  const handleSendMessage = async () => {
    if (!chatInput.trim() || isSending) return

    const message = chatInput.trim()
    setChatInput('')
    clearError()
    await sendMessage(message)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const handleDelete = async () => {
    if (confirm('Delete this session? This cannot be undone.')) {
      await deleteSession(session.id)
      onBack()
    }
  }

  const handleSuggestionClick = async (prompt: string) => {
    clearError()
    await sendMessage(prompt)
  }

  const handleOpenPath = async (path: string | undefined) => {
    if (!path || !isTauri()) return
    setOpenError(null)
    try {
      const { open } = await import('@tauri-apps/plugin-shell')
      await open(path)
    } catch (error) {
      console.error('Failed to open path:', error)
      setOpenError('Failed to open file. Check permissions in Settings.')
    }
  }

  const handleRevealPath = async (path: string | undefined) => {
    if (!path || !isTauri()) return
    setOpenError(null)
    try {
      const { Command } = await import('@tauri-apps/plugin-shell')
      await Command.create('reveal-in-finder', ['-R', path]).execute()
    } catch (error) {
      console.error('Failed to reveal in Finder:', error)
      setOpenError('Failed to reveal file in Finder.')
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen bg-[var(--paper)] texture-grain"
    >
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[var(--paper)]/90 backdrop-blur-md border-b border-[var(--border-subtle)]">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors duration-200"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Back</span>
          </button>

          {/* Saved indicator */}
          <AnimatePresence>
            {showSaved && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-1.5 text-sm text-[var(--success)]"
              >
                <Check className="w-4 h-4" />
                <span>Saved</span>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-2.5 rounded-lg hover:bg-[var(--paper-warm)] transition-colors duration-200"
            >
              <MoreHorizontal className="w-5 h-5 text-[var(--ink-muted)]" />
            </button>

            <AnimatePresence>
              {showMenu && (
                <>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-10"
                    onClick={() => setShowMenu(false)}
                  />
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -10 }}
                    className="absolute right-0 top-full mt-2 z-20 w-48 py-2 rounded-xl bg-[var(--paper-warm)] border border-[var(--border-medium)] shadow-[var(--shadow-lg)]"
                  >
                    <button
                      onClick={handleDelete}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-[var(--error)] hover:bg-[var(--error-muted)] transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span className="text-sm">Delete Session</span>
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-6 py-10">
        {/* Title & Meta */}
        <motion.header
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="mb-10"
        >
          {/* Session type badge */}
          <div className="flex items-center gap-3 mb-4">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium ${
              session.type === 'session'
                ? 'bg-[var(--session-recording-muted)] text-[var(--session-recording)]'
                : 'bg-[var(--session-capture-muted)] text-[var(--session-capture)]'
            }`}>
              {session.type === 'session' ? (
                <Video className="w-3.5 h-3.5" />
              ) : (
                <Feather className="w-3.5 h-3.5" />
              )}
              <span>{session.type === 'session' ? 'Recording' : 'Capture'}</span>
            </div>
            {session.duration && (
              <span className="text-xs text-[var(--ink-muted)]">
                {formatDuration(session.duration)}
              </span>
            )}
            {session.status === 'interrupted' && (
              <span className="text-xs text-[var(--ink-muted)]/70 flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--ink-muted)]/60" />
                Interrupted
              </span>
            )}
            <span className="text-xs text-[var(--ink-muted)]">
              {formatDate(session.createdAt)}
            </span>
          </div>

          {/* Title - click to edit */}
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              type="text"
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              onBlur={async () => {
                setIsEditingTitle(false)
                if (editedTitle !== session.title && editedTitle.trim()) {
                  const updatedSession = { ...session, title: editedTitle.trim() }
                  await updateSession(updatedSession)
                } else {
                  setEditedTitle(session.title) // Reset if empty
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur()
                } else if (e.key === 'Escape') {
                  setEditedTitle(session.title)
                  setIsEditingTitle(false)
                }
              }}
              className="font-display text-4xl md:text-5xl font-light text-[var(--ink)] tracking-tight leading-tight bg-transparent border-b-2 border-[var(--accent)] outline-none w-full"
              autoFocus
            />
          ) : (
            <h1
              onClick={() => {
                setIsEditingTitle(true)
                setTimeout(() => titleInputRef.current?.focus(), 0)
              }}
              className="font-display text-4xl md:text-5xl font-light text-[var(--ink)] tracking-tight leading-tight cursor-pointer hover:text-[var(--ink)]/80 transition-colors"
              title="Click to edit title"
            >
              {session.title}
            </h1>
          )}
        </motion.header>

        {/* Summary */}
        {summary ? (
          <div className="space-y-10">
            {/* Recording Video */}
            {session.videoPath && (
              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--paper)]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[var(--session-recording-muted)] flex items-center justify-center">
                        <Video className="w-5 h-5 text-[var(--session-recording)]" />
                      </div>
                      <div>
                        <h3 className="font-medium text-[var(--ink)]">Recording</h3>
                        <p className="text-xs text-[var(--ink-muted)]">Open the session video</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleOpenPath(session.videoPath)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        handleRevealPath(session.videoPath)
                      }}
                      className="px-4 py-2 rounded-lg text-sm border border-[var(--border-medium)] hover:bg-[var(--paper-warm)] transition-colors"
                    >
                      Open
                    </button>
                  </div>
                  <p className="mt-2 text-[10px] text-[var(--ink-muted)]/70">
                    Right click to reveal in Finder
                  </p>
                </div>
              </motion.section>
            )}

            {/* AI Summary Card - The Hero */}
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="ai-summary-card p-8">
                {/* Header */}
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-8 h-8 rounded-lg bg-[var(--accent)] flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h2 className="label-section !text-[var(--accent)]">AI Summary</h2>
                  </div>
                </div>

                {/* Summary text - editorial style */}
                <div
                  className={`font-display text-xl md:text-2xl leading-relaxed text-[var(--ink)] drop-cap ${showTypewriter ? 'cursor-pointer' : ''}`}
                  onClick={() => showTypewriter && setShowTypewriter(false)}
                  title={showTypewriter ? 'Click to skip animation' : undefined}
                >
                  {showTypewriter ? (
                    <TypewriterText
                      text={summary.text}
                      onComplete={() => setShowTypewriter(false)}
                    />
                  ) : (
                    summary.text
                  )}
                </div>
              </div>
            </motion.section>

            {/* Tasks Section */}
            {summary.tasks.length > 0 && (
              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
              >
                {/* Section header with progress */}
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <ListChecks className="w-5 h-5 text-[var(--ink-muted)]" />
                    <h2 className="label-section">Action Items</h2>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Progress bar */}
                    <div className="w-24 h-1.5 bg-[var(--paper-dark)] rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-[var(--success)]"
                        initial={{ width: 0 }}
                        animate={{ width: `${(completedTasks / totalTasks) * 100}%` }}
                        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                      />
                    </div>
                    <span className="text-xs text-[var(--ink-muted)] tabular-nums">
                      {completedTasks}/{totalTasks}
                    </span>
                  </div>
                </div>

                {/* All tasks complete celebration */}
                <AnimatePresence>
                  {allTasksComplete && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mb-4 p-4 rounded-xl bg-[var(--success-muted)] border border-[var(--success)]/20"
                    >
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="w-5 h-5 text-[var(--success)]" />
                        <span className="text-sm font-medium text-[var(--success)]">
                          All tasks complete!
                        </span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Task list */}
                <div className="space-y-2">
                  {summary.tasks.map((task, index) => (
                    <motion.button
                      key={task.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3 + index * 0.05, duration: 0.3 }}
                      onClick={() => handleToggleTask(task.id)}
                      className={`w-full flex items-start gap-4 p-4 rounded-xl border transition-all duration-300 text-left group ${
                        task.completed
                          ? 'bg-[var(--success-muted)] border-[var(--success)]/20'
                          : 'bg-[var(--paper-warm)] border-[var(--border-subtle)] hover:border-[var(--border-medium)] hover:shadow-[var(--shadow-sm)]'
                      }`}
                    >
                      <motion.div
                        initial={false}
                        animate={task.completed ? { scale: [1, 1.3, 1] } : {}}
                        transition={{ duration: 0.3 }}
                        className="mt-0.5"
                      >
                        {task.completed ? (
                          <CheckCircle2 className="w-5 h-5 text-[var(--success)]" />
                        ) : (
                          <Circle className="w-5 h-5 text-[var(--ink-muted)] group-hover:text-[var(--accent)] transition-colors" />
                        )}
                      </motion.div>
                      <span className={`flex-1 text-[var(--ink)] transition-all ${
                        task.completed ? 'line-through opacity-60' : ''
                      }`}>
                        {task.title}
                      </span>
                    </motion.button>
                  ))}
                </div>
              </motion.section>
            )}

            {/* Notes Section */}
            {summary.notes.length > 0 && (
              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="flex items-center gap-3 mb-5">
                  <StickyNote className="w-5 h-5 text-[var(--ink-muted)]" />
                  <h2 className="label-section">Key Notes</h2>
                </div>
                <div className="space-y-3">
                  {summary.notes.map((note, index) => (
                    <motion.div
                      key={note.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.4 + index * 0.05, duration: 0.3 }}
                      className="flex items-start gap-4 p-4 rounded-xl bg-[var(--paper-warm)] border border-[var(--border-subtle)]"
                    >
                      <div className="w-1 h-full min-h-[1.5rem] rounded-full bg-[var(--accent)]/30" />
                      <p className="flex-1 text-[var(--ink)] leading-relaxed">
                        {note.content}
                      </p>
                    </motion.div>
                  ))}
                </div>
              </motion.section>
            )}

            {/* Media Error Display */}
            {mediaError && (
              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">
                  <p className="text-sm">{mediaError}</p>
                  <button
                    onClick={() => {
                      setMediaError(null)
                      setLoadingMedia(true)
                      Promise.all([
                        getScreenshots(session.id),
                        getAudioChunks(session.id),
                      ]).then(([ss, audio]) => {
                        setScreenshots(ss)
                        setAudioChunks(audio)
                      }).catch((error) => {
                        console.error('Failed to load media:', error)
                        setMediaError('Failed to load screenshots and audio. Please try again.')
                      }).finally(() => {
                        setLoadingMedia(false)
                      })
                    }}
                    className="text-sm underline mt-2"
                  >
                    Retry
                  </button>
                </div>
              </motion.section>
            )}

            {/* Screenshots Section (for sessions only) */}
            {session.type === 'session' && !mediaError && (loadingMedia || screenshots.length > 0) && (
              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="flex items-center gap-3 mb-5">
                  <Camera className="w-5 h-5 text-[var(--ink-muted)]" />
                  <h2 className="label-section">Screenshots</h2>
                </div>
                {loadingMedia ? (
                  <div className="grid grid-cols-4 gap-3">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="aspect-video bg-[var(--paper-dark)] rounded-lg animate-pulse" />
                    ))}
                  </div>
                ) : (
                  <ScreenshotGallery screenshots={screenshots} />
                )}
              </motion.section>
            )}

            {/* Transcript Section (for sessions only) - only show if there are actual transcripts */}
            {session.type === 'session' && !mediaError && audioChunks.some(c => c.transcript) && (
              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
              >
                <TranscriptViewer audioChunks={audioChunks} />
              </motion.section>
            )}

            {/* Original Input (collapsible) */}
            {session.captureText && (
              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
              >
                <details className="group">
                  <summary className="flex items-center gap-3 cursor-pointer select-none mb-3">
                    <BookOpen className="w-5 h-5 text-[var(--ink-muted)]" />
                    <span className="label-section">Original Input</span>
                  </summary>
                  <div className="p-5 rounded-xl bg-[var(--paper-dark)] border border-[var(--border-subtle)]">
                    <p className="text-sm text-[var(--ink-muted)] whitespace-pre-wrap leading-relaxed font-mono">
                      {session.captureText}
                    </p>
                  </div>
                </details>
              </motion.section>
            )}

            {/* Attachments */}
            {session.attachments && session.attachments.length > 0 && (
              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.45, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <Paperclip className="w-5 h-5 text-[var(--ink-muted)]" />
                  <h2 className="label-section">Attachments</h2>
                </div>
                <div className="space-y-2">
                  {session.attachments.map((attachment) => {
                    const Icon = getAttachmentIcon(attachment.type)
                    return (
                      <button
                        key={attachment.id}
                        onClick={() => handleOpenPath(attachment.path)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          handleRevealPath(attachment.path)
                        }}
                        className="w-full flex items-center gap-4 p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--paper)] hover:bg-[var(--paper-warm)] transition-colors text-left"
                      >
                        <div className="w-9 h-9 rounded-lg bg-[var(--paper-warm)] flex items-center justify-center">
                          <Icon className="w-4 h-4 text-[var(--ink-muted)]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-[var(--ink)] truncate">{attachment.name}</div>
                          <div className="text-xs text-[var(--ink-muted)]">
                            {attachment.mimeType || attachment.type} · {formatBytes(attachment.size)}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
                <p className="mt-2 text-[10px] text-[var(--ink-muted)]/70">
                  Right click an item to reveal in Finder
                </p>
              </motion.section>
            )}

            {/* AI Chat Section */}
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="pt-10 border-t border-[var(--border-subtle)]"
            >
              {/* Header */}
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-[var(--accent)] flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="font-medium text-[var(--ink)]">Continue with AI</h2>
                  <p className="text-xs text-[var(--ink-muted)]">
                    Ask questions, get insights, or take action
                  </p>
                </div>
              </div>

              {/* Chat messages */}
              <AnimatePresence>
                {chatMessages.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="space-y-4 mb-6"
                  >
                    {chatMessages.map((message) => (
                      <motion.div
                        key={message.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[85%] px-5 py-3 rounded-2xl whitespace-pre-wrap ${
                            message.role === 'user'
                              ? 'bg-[var(--ink)] text-[var(--paper)] shadow-[var(--shadow-md)]'
                              : 'bg-[var(--paper-warm)] border border-[var(--border-subtle)] text-[var(--ink)]'
                          }`}
                        >
                          {message.content}
                        </div>
                      </motion.div>
                    ))}

                    {/* Typing indicator */}
                    {isSending && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex justify-start"
                      >
                        <div className="px-3 py-2 rounded-2xl bg-[var(--paper-warm)] border border-[var(--border-subtle)]">
                          <TypingIndicator />
                        </div>
                      </motion.div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Suggestion chips */}
              {chatMessages.length === 0 && (
                <div className="flex flex-wrap gap-2 mb-6">
                  {[
                    { label: 'Summarize briefly', prompt: 'Summarize this in one sentence' },
                    { label: 'Key takeaways', prompt: 'What are the main takeaways from this?' },
                    { label: 'What\'s next?', prompt: 'Based on this, what should I prioritize?' },
                    { label: 'Find more tasks', prompt: 'Are there any action items I might have missed?' },
                  ].map((suggestion) => (
                    <button
                      key={suggestion.label}
                      onClick={() => handleSuggestionClick(suggestion.prompt)}
                      disabled={isSending}
                      className="px-4 py-2 rounded-lg text-sm border border-[var(--border-medium)] text-[var(--ink-muted)] hover:text-[var(--ink)] hover:border-[var(--accent)] hover:bg-[var(--accent-muted)] transition-all duration-200 disabled:opacity-50"
                    >
                      {suggestion.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Error message */}
              <AnimatePresence>
                {(chatError || openError) && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="flex items-center gap-3 p-4 mb-4 rounded-xl bg-[var(--error-muted)] border border-[var(--error)]/20"
                  >
                    <AlertCircle className="w-5 h-5 text-[var(--error)] flex-shrink-0" />
                    <span className="flex-1 text-sm text-[var(--error)]">
                      {chatError || openError}
                    </span>
                    <button
                      onClick={() => {
                        clearError()
                        setOpenError(null)
                      }}
                      className="p-1 rounded hover:bg-[var(--error)]/10 transition-colors"
                    >
                      <X className="w-4 h-4 text-[var(--error)]" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Input */}
              <div className="flex items-center gap-3">
                <label htmlFor="chat-input" className="sr-only">Ask a question about this session</label>
                <input
                  id="chat-input"
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask anything about this session..."
                  className="flex-1 px-5 py-3.5 rounded-xl border border-[var(--border-medium)] bg-[var(--paper)] text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition-all duration-200"
                />
                <motion.button
                  onClick={handleSendMessage}
                  disabled={!chatInput.trim() || isSending}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  aria-label="Send message"
                  className="p-3.5 rounded-xl bg-[var(--accent)] text-white hover:bg-[var(--accent-light)] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-[var(--shadow-md)]"
                >
                  <Send className="w-5 h-5" />
                </motion.button>
              </div>
            </motion.section>
          </div>
        ) : (
          /* Loading state - Crystallizing thoughts */
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-20"
          >
            {/* Geometric processing animation */}
            <div className="relative w-24 h-24 mb-8">
              {/* Outer rotating ring */}
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
                className="absolute inset-0 rounded-full border border-[var(--accent)]/20"
              />
              {/* Middle pulsing ring */}
              <motion.div
                animate={{ scale: [0.8, 1, 0.8], opacity: [0.3, 0.6, 0.3] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute inset-3 rounded-full border-2 border-[var(--accent)]/40"
              />
              {/* Inner solid circle */}
              <motion.div
                animate={{ scale: [0.9, 1.1, 0.9] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute inset-6 rounded-full bg-[var(--accent)]"
              />
              {/* Orbiting dot */}
              <motion.div
                animate={{ rotate: -360 }}
                transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                className="absolute inset-0"
              >
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-[var(--accent)]" />
              </motion.div>
            </div>

            <h2 className="font-display text-2xl text-[var(--ink)] mb-2">
              Analyzing your session
            </h2>
            <p className="text-[var(--ink-muted)] text-center max-w-xs">
              AI is extracting insights, tasks, and key notes...
            </p>
          </motion.div>
        )}
      </main>
    </motion.div>
  )
}
