/**
 * LiveTranscript
 *
 * Streaming transcription display for live sessions.
 * Shows real-time transcription with auto-scroll behavior.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff, Loader2, Key } from 'lucide-react'
import { sessionBridge } from '../services/session-bridge'
import { getSecureItem } from '../services/secure-storage'
import { generateId } from '../utils/id'

interface TranscriptChunk {
  id: string
  text: string
  timestamp: Date
}

interface LiveTranscriptProps {
  sessionId: string
  /** Is audio recording enabled */
  audioEnabled: boolean
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function LiveTranscript({ sessionId, audioEnabled }: LiveTranscriptProps) {
  const [chunks, setChunks] = useState<TranscriptChunk[]>([])
  const [status, setStatus] = useState<'idle' | 'listening' | 'transcribing' | 'error'>('idle')
  const [hasOpenaiKey, setHasOpenaiKey] = useState<boolean | null>(null) // null = loading
  const [isUserScrolled, setIsUserScrolled] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const lastScrollTop = useRef(0)

  // Check for OpenAI API key on mount
  useEffect(() => {
    getSecureItem('sessions_openai_api_key').then(key => {
      setHasOpenaiKey(!!key)
    })
  }, [])

  // Auto-scroll to bottom when new content arrives (unless user scrolled up)
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const scrollToBottom = useCallback(() => {
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)
    scrollTimeoutRef.current = setTimeout(() => {
      if (!isUserScrolled && containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight
      }
    }, 100)
  }, [isUserScrolled])

  // Clean up scroll debounce timer on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)
    }
  }, [])

  // Detect user scroll
  const handleScroll = () => {
    if (!containerRef.current) return

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50

    // User scrolled up
    if (scrollTop < lastScrollTop.current && !isAtBottom) {
      setIsUserScrolled(true)
    }

    // User scrolled back to bottom
    if (isAtBottom) {
      setIsUserScrolled(false)
    }

    lastScrollTop.current = scrollTop
  }

  // Listen to transcription events
  useEffect(() => {
    if (!audioEnabled) {
      setStatus('idle')
      return
    }

    setStatus('listening')

    const unsubStart = sessionBridge.on('transcription-start', (data) => {
      if (data.sessionId !== sessionId) return
      setStatus('transcribing')
    })

    const unsubComplete = sessionBridge.on('transcription-complete', (data) => {
      if (data.sessionId !== sessionId) return

      if (data.text) {
        const newChunk: TranscriptChunk = {
          id: generateId(),
          text: data.text,
          timestamp: new Date(),
        }
        setChunks(prev => [...prev, newChunk])
      }

      setStatus('listening')
    })

    const unsubError = sessionBridge.on('error', (data) => {
      if (data.sessionId !== sessionId) return
      if (data.error?.includes('transcription')) {
        setStatus('error')
      }
    })

    return () => {
      unsubStart()
      unsubComplete()
      unsubError()
    }
  }, [sessionId, audioEnabled])

  // Scroll to bottom when new chunks arrive
  useEffect(() => {
    scrollToBottom()
  }, [chunks, scrollToBottom])

  // Audio not enabled
  if (!audioEnabled) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center px-4">
          <MicOff className="w-8 h-8 text-[var(--ink-muted)] mx-auto mb-3" />
          <p className="text-sm text-[var(--ink-muted)]">
            Audio recording is disabled
          </p>
        </div>
      </div>
    )
  }

  // No OpenAI key configured - show clear message
  if (hasOpenaiKey === false) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center px-4">
          <div className="w-12 h-12 rounded-full bg-[var(--warning-muted)] flex items-center justify-center mx-auto mb-3">
            <Key className="w-6 h-6 text-[var(--warning)]" />
          </div>
          <p className="text-sm text-[var(--ink)]">
            OpenAI API key required
          </p>
          <p className="text-xs text-[var(--ink-muted)] mt-1">
            Add your OpenAI key in Settings for live transcription
          </p>
        </div>
      </div>
    )
  }

  // Error state
  if (status === 'error') {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center px-4">
          <div className="w-12 h-12 rounded-full bg-[var(--error-muted)] flex items-center justify-center mx-auto mb-3">
            <MicOff className="w-6 h-6 text-[var(--error)]" />
          </div>
          <p className="text-sm text-[var(--error)]">
            Transcription unavailable
          </p>
          <p className="text-xs text-[var(--ink-muted)] mt-1">
            Check your OpenAI API key in Settings
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Status indicator - no duplicate header, Panel provides title */}
      <div className="flex items-center justify-end mb-3">
        <AnimatePresence mode="wait">
          {status === 'transcribing' ? (
            <motion.div
              key="transcribing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1.5 text-xs text-[var(--accent)]"
            >
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Transcribing...</span>
            </motion.div>
          ) : status === 'listening' ? (
            <motion.div
              key="listening"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-1.5 text-xs text-[var(--ink-muted)]"
            >
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                <Mic className="w-3 h-3" />
              </motion.div>
              <span>Listening...</span>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {chunks.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center px-4">
            <motion.div
              animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="w-12 h-12 rounded-full bg-[var(--paper-warm)] flex items-center justify-center mx-auto mb-3"
            >
              <Mic className="w-6 h-6 text-[var(--ink-muted)]" />
            </motion.div>
            <p className="text-sm text-[var(--ink-muted)]">
              Waiting for speech...
            </p>
          </div>
        </div>
      ) : (
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto pr-2 -mr-2"
        >
          <div className="space-y-4">
            {chunks.map((chunk, index) => (
              <motion.div
                key={chunk.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                {/* Show timestamp for first chunk or when there's a gap */}
                {(index === 0 ||
                  chunk.timestamp.getTime() - chunks[index - 1].timestamp.getTime() > 60000) && (
                  <p className="text-xs text-[var(--ink-muted)] mb-2">
                    {formatTime(chunk.timestamp)}
                  </p>
                )}
                <p className="text-sm text-[var(--ink)] leading-relaxed">
                  {chunk.text}
                </p>
              </motion.div>
            ))}
          </div>

          {/* Scroll indicator when user scrolled up */}
          <AnimatePresence>
            {isUserScrolled && (
              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                onClick={() => {
                  setIsUserScrolled(false)
                  containerRef.current?.scrollTo({
                    top: containerRef.current.scrollHeight,
                    behavior: 'smooth',
                  })
                }}
                className="sticky bottom-2 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-[var(--accent)] text-white text-xs shadow-lg"
              >
                Scroll to latest
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
