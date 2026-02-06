import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Send,
  AlertCircle,
  X,
  Sparkles,
} from 'lucide-react'
import { TypingIndicator } from '../TypingIndicator'
import { useSessionChat } from '../../hooks/useSessionChat'

interface SummaryChatProps {
  sessionId: string
  openError: string | null
  onClearOpenError: () => void
}

export function SummaryChat({ sessionId, openError, onClearOpenError }: SummaryChatProps) {
  const [chatInput, setChatInput] = useState('')
  const chatInputRef = useRef<HTMLTextAreaElement>(null)
  const {
    messages: chatMessages,
    isSending,
    error: chatError,
    sendMessage,
    clearError,
  } = useSessionChat(sessionId)

  // Auto-resize chat textarea
  useEffect(() => {
    const el = chatInputRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 120) + 'px'
    }
  }, [chatInput])

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

  const handleSuggestionClick = async (prompt: string) => {
    clearError()
    await sendMessage(prompt)
    chatInputRef.current?.focus()
  }

  return (
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
                onClearOpenError()
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
        <textarea
          ref={chatInputRef}
          id="chat-input"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything about this session..."
          rows={1}
          className="flex-1 px-5 py-3.5 rounded-xl border border-[var(--border-medium)] bg-[var(--paper)] text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition-all duration-200 resize-none"
          style={{ maxHeight: '120px', overflow: 'auto' }}
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
  )
}
