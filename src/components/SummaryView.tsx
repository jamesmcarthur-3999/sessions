import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  FileText,
  Send,
  Video,
  Feather,
  Trash2,
  MoreHorizontal,
  AlertCircle,
  X,
  Sparkles,
  BookOpen,
  ListChecks,
  StickyNote,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { ai } from '../services/ai'
import type { Session, Task } from '../types'

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

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
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
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [isSending, setIsSending] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [showMenu, setShowMenu] = useState(false)
  const [showTypewriter, setShowTypewriter] = useState(true)

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

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: chatInput,
    }

    setChatMessages((prev) => [...prev, userMessage])
    setChatInput('')
    setIsSending(true)
    setChatError(null)

    try {
      const sessionContext = `Title: ${session.title}
Type: ${session.type}
${session.summary ? `Summary: ${session.summary.text}
Tasks: ${session.summary.tasks.map(t => `- [${t.completed ? 'x' : ' '}] ${t.title}`).join('\n')}
Notes: ${session.summary.notes.map(n => `- ${n.content}`).join('\n')}` : ''}
${session.captureText ? `Original text: ${session.captureText.slice(0, 1000)}...` : ''}`

      const response = await ai.chat(session.id, chatInput, sessionContext)

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
      }

      setChatMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      console.error('Chat error:', error)
      setChatError(
        error instanceof Error
          ? error.message
          : 'Failed to get response. Check your API key in Settings.'
      )
    } finally {
      setIsSending(false)
    }
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
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: prompt,
    }
    setChatMessages((prev) => [...prev, userMessage])
    setIsSending(true)
    setChatError(null)

    try {
      const sessionContext = `Title: ${session.title}
Type: ${session.type}
${session.summary ? `Summary: ${session.summary.text}
Tasks: ${session.summary.tasks.map(t => `- [${t.completed ? 'x' : ' '}] ${t.title}`).join('\n')}
Notes: ${session.summary.notes.map(n => `- ${n.content}`).join('\n')}` : ''}
${session.captureText ? `Original text: ${session.captureText.slice(0, 1000)}` : ''}`

      const response = await ai.chat(session.id, prompt, sessionContext)
      setChatMessages((prev) => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
      }])
    } catch (error) {
      console.error('Chat error:', error)
      setChatError(
        error instanceof Error
          ? error.message
          : 'Failed to get response. Check your API key in Settings.'
      )
    } finally {
      setIsSending(false)
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
            <span className="text-xs text-[var(--ink-muted)]">
              {formatDate(session.createdAt)}
            </span>
          </div>

          {/* Title */}
          <h1 className="font-display text-4xl md:text-5xl font-light text-[var(--ink)] tracking-tight leading-tight">
            {session.title}
          </h1>
        </motion.header>

        {/* Summary */}
        {summary ? (
          <div className="space-y-10">
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
                <div className="font-display text-xl md:text-2xl leading-relaxed text-[var(--ink)] drop-cap">
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

                    {/* Thinking indicator */}
                    {isSending && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex justify-start"
                      >
                        <div className="px-5 py-3 rounded-2xl bg-[var(--paper-warm)] border border-[var(--border-subtle)]">
                          <div className="flex items-center gap-2">
                            <motion.div
                              animate={{ rotate: 360 }}
                              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                              className="w-4 h-4 rounded-full border-2 border-[var(--accent)]/30 border-t-[var(--accent)]"
                            />
                            <span className="text-sm text-[var(--ink-muted)] italic">Thinking...</span>
                          </div>
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
                {chatError && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="flex items-center gap-3 p-4 mb-4 rounded-xl bg-[var(--error-muted)] border border-[var(--error)]/20"
                  >
                    <AlertCircle className="w-5 h-5 text-[var(--error)] flex-shrink-0" />
                    <span className="flex-1 text-sm text-[var(--error)]">
                      {chatError}
                    </span>
                    <button
                      onClick={() => setChatError(null)}
                      className="p-1 rounded hover:bg-[var(--error)]/10 transition-colors"
                    >
                      <X className="w-4 h-4 text-[var(--error)]" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Input */}
              <div className="flex items-center gap-3">
                <input
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
