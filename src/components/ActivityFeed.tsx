/**
 * ActivityFeed
 *
 * Real-time activity stream with timeline visualization.
 * Shows events as they happen during recording.
 */

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Camera, MessageSquare, Lightbulb, ArrowRight, Zap, Bookmark } from 'lucide-react'
import { sessionBridge } from '../services/session-bridge'
import { smartCapture } from '../services/smart-capture'
import { formatRelativeTimeLive } from '../utils/formatting'
import { generateId } from '../utils/id'

interface ActivityItem {
  id: string
  type: 'app-switch' | 'screenshot' | 'speech' | 'insight' | 'quiet' | 'topic'
  content: string
  timestamp: Date
  metadata?: {
    fromApp?: string
    toApp?: string
    thumbnailBase64?: string
  }
}

interface ActivityFeedProps {
  sessionId: string
  maxItems?: number
}

// Type configurations for visual treatment
const typeConfig = {
  'app-switch': {
    icon: ArrowRight,
    color: 'var(--info)',
    bg: 'var(--info-muted)',
    label: 'Switch',
  },
  'screenshot': {
    icon: Camera,
    color: 'var(--success)',
    bg: 'var(--success-muted)',
    label: 'Capture',
  },
  'speech': {
    icon: MessageSquare,
    color: 'var(--speech)',
    bg: 'var(--speech-muted)',
    label: 'Speech',
  },
  'insight': {
    icon: Lightbulb,
    color: 'var(--accent)',
    bg: 'var(--accent-muted)',
    label: 'Insight',
  },
  'quiet': {
    icon: Zap,
    color: 'var(--ink-muted)',
    bg: 'var(--paper-dark)',
    label: 'Activity',
  },
  'topic': {
    icon: Bookmark,
    color: 'var(--info)',
    bg: 'var(--info-muted)',
    label: 'Topic',
  },
}

export function ActivityFeed({ sessionId, maxItems = 20 }: ActivityFeedProps) {
  const [items, setItems] = useState<ActivityItem[]>([])
  const [, forceUpdate] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  // Update relative times every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => forceUpdate(n => n + 1), 10000)
    return () => clearInterval(interval)
  }, [])

  // Listen to session coordinator events
  useEffect(() => {
    const addItem = (item: Omit<ActivityItem, 'id' | 'timestamp'>) => {
      const newItem: ActivityItem = {
        ...item,
        id: generateId(),
        timestamp: new Date(),
      }
      setItems(prev => [newItem, ...prev].slice(0, maxItems))
    }

    // Activity detected (includes app switches)
    const unsubActivity = sessionBridge.on('activity-detected', (data) => {
      if (data.sessionId !== sessionId) return

      const activity = data.activity

      const content = activity?.currentApp
        ? `${activity.currentApp}: ${activity.currentContext || 'Active'}`
        : activity?.currentContext || 'Activity detected'

      addItem({
        type: 'app-switch',
        content,
      })
    })

    // Insight created
    const unsubInsight = sessionBridge.on('insight-created', (data) => {
      if (data.sessionId !== sessionId) return
      addItem({
        type: 'insight',
        content: data.content?.substring(0, 60) + (data.content?.length > 60 ? '...' : '') || 'New insight',
      })
    })

    // Live transcription events — show final transcripts in feed
    const unsubTranscript = sessionBridge.on('live-transcript', (data) => {
      if (data.sessionId !== sessionId || !data.isFinal) return
      const preview = data.text?.substring(0, 50) + (data.text?.length > 50 ? '...' : '') || 'Audio transcribed'
      addItem({
        type: 'speech',
        content: `"${preview}"`,
      })
    })

    // Screenshot captured via smart capture
    const unsubCapture = smartCapture.on('capture', (data) => {
      addItem({
        type: 'screenshot',
        content: data.trigger === 'app_switch'
          ? `App switch captured`
          : data.trigger === 'activity'
            ? 'Activity captured'
            : 'Screenshot captured',
      })
    })

    // Throttled speech markers (at most 1 per 30 seconds)
    let lastSpeechTime = 0
    const unsubLiveSpeech = sessionBridge.on('live-speech-started', (data) => {
      if (data.sessionId !== sessionId) return
      const now = Date.now()
      if (now - lastSpeechTime < 30_000) return
      lastSpeechTime = now
      addItem({ type: 'speech', content: 'Speech detected' })
    })

    // Topic changes from Session Narrator
    const unsubTopic = sessionBridge.on('topic-change', (data) => {
      if (data.sessionId !== sessionId) return
      addItem({ type: 'topic', content: data.topic })
    })

    return () => {
      unsubActivity()
      unsubInsight()
      unsubTranscript()
      unsubCapture()
      unsubLiveSpeech()
      unsubTopic()
    }
  }, [sessionId, maxItems])

  // Empty state
  if (items.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center px-6"
        >
          <motion.div
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="w-12 h-12 mx-auto mb-3 rounded-xl bg-[var(--paper-dark)] flex items-center justify-center"
          >
            <Zap className="w-5 h-5 text-[var(--ink-muted)]" />
          </motion.div>
          <p className="text-sm text-[var(--ink-muted)]">
            Activity will appear as you work
          </p>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Counter badge */}
      <div className="flex items-center justify-end mb-3">
        <span className="text-[10px] font-medium text-[var(--ink-muted)] bg-[var(--paper-dark)] px-2 py-0.5 rounded-full tabular-nums">
          {items.length} events
        </span>
      </div>

      {/* Timeline */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto pr-1 -mr-1"
      >
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-[11px] top-2 bottom-2 w-px bg-gradient-to-b from-[var(--border-medium)] via-[var(--border-subtle)] to-transparent" />

          <AnimatePresence initial={false}>
            {items.map((item, index) => {
              const config = typeConfig[item.type]
              const Icon = config.icon

              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  className="relative flex gap-3 pb-3"
                >
                  {/* Timeline dot */}
                  <div className="relative z-10 flex-shrink-0">
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.1, type: 'spring', stiffness: 500, damping: 25 }}
                      className="w-6 h-6 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: config.bg }}
                    >
                      <Icon className="w-3 h-3" style={{ color: config.color }} />
                    </motion.div>
                    {/* Pulse for latest item */}
                    {index === 0 && (
                      <motion.div
                        initial={{ opacity: 0.6, scale: 1 }}
                        animate={{ opacity: 0, scale: 2 }}
                        transition={{ duration: 1, repeat: 2 }}
                        className="absolute inset-0 rounded-full"
                        style={{ backgroundColor: config.color }}
                      />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 pt-0.5">
                    <p className="text-sm text-[var(--ink)] leading-snug line-clamp-2">
                      {item.content}
                    </p>
                    <p className="text-[10px] text-[var(--ink-muted)] mt-0.5 tabular-nums">
                      {formatRelativeTimeLive(item.timestamp)}
                    </p>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
