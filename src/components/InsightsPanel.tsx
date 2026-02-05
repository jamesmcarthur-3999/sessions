/**
 * InsightsPanel
 *
 * AI insights panel showing real-time generated insights during recording.
 * Cards can be pinned to ensure they appear in the final summary.
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { InsightCard, type Insight } from './InsightCard'
import { sessionBridge } from '../services/session-bridge'

interface InsightsPanelProps {
  sessionId: string
  maxItems?: number
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 9)
}

// Classify insight type based on content
function classifyInsight(content: string, insightType?: string): Insight['type'] {
  const lowerContent = content.toLowerCase()

  // Check explicit type first
  if (insightType === 'task' || insightType === 'follow-up' || insightType === 'key-insight' || insightType === 'summary') {
    return insightType
  }

  // Heuristic classification
  if (
    lowerContent.includes('todo') ||
    lowerContent.includes('need to') ||
    lowerContent.includes('should') ||
    lowerContent.includes('must') ||
    lowerContent.includes('task:') ||
    lowerContent.startsWith('review ') ||
    lowerContent.startsWith('update ') ||
    lowerContent.startsWith('fix ') ||
    lowerContent.startsWith('add ')
  ) {
    return 'task'
  }

  if (
    lowerContent.includes('follow up') ||
    lowerContent.includes('follow-up') ||
    lowerContent.includes('reminder') ||
    lowerContent.includes('don\'t forget') ||
    lowerContent.includes('remember to')
  ) {
    return 'follow-up'
  }

  if (
    lowerContent.includes('summary') ||
    lowerContent.includes('overview')
  ) {
    return 'summary'
  }

  return 'key-insight'
}

export function InsightsPanel({ sessionId, maxItems = 15 }: InsightsPanelProps) {
  const [insights, setInsights] = useState<Insight[]>([])
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set())

  // Listen to insight events
  useEffect(() => {
    const unsubInsight = sessionBridge.on('insight-created', (data) => {
      if (data.sessionId !== sessionId) return

      const newInsight: Insight = {
        id: generateId(),
        type: classifyInsight(data.content || '', data.type),
        content: data.content || 'New insight generated',
        timestamp: new Date(),
        isPinned: false,
      }

      setInsights(prev => [newInsight, ...prev].slice(0, maxItems))
    })

    // Also listen for summary updates as insights
    const unsubSummary = sessionBridge.on('summary-updated', (data) => {
      if (data.sessionId !== sessionId) return

      const newInsight: Insight = {
        id: generateId(),
        type: 'summary',
        content: 'Session summary updated with latest activity',
        timestamp: new Date(),
        isPinned: false,
      }

      setInsights(prev => [newInsight, ...prev].slice(0, maxItems))
    })

    return () => {
      unsubInsight()
      unsubSummary()
    }
  }, [sessionId, maxItems])

  // Handle pin/unpin
  const handlePin = (id: string) => {
    setPinnedIds(prev => new Set([...prev, id]))
    setInsights(prev =>
      prev.map(i => i.id === id ? { ...i, isPinned: true } : i)
    )
  }

  const handleUnpin = (id: string) => {
    setPinnedIds(prev => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    setInsights(prev =>
      prev.map(i => i.id === id ? { ...i, isPinned: false } : i)
    )
  }

  // Separate pinned and unpinned insights
  const pinnedInsights = insights.filter(i => i.isPinned)
  const unpinnedInsights = insights.filter(i => !i.isPinned)

  if (insights.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center px-4">
          <motion.div
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 3, repeat: Infinity }}
            className="w-12 h-12 rounded-full bg-[var(--accent-muted)] flex items-center justify-center mx-auto mb-3"
          >
            <Sparkles className="w-6 h-6 text-[var(--accent)]" />
          </motion.div>
          <p className="text-sm text-[var(--ink-muted)]">
            AI is analyzing your session...
          </p>
          <p className="text-xs text-[var(--ink-muted)] mt-1">
            Insights will appear as you work
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Counter badges - no duplicate header, Panel provides title */}
      <div className="flex items-center justify-end gap-2 mb-3">
        {pinnedIds.size > 0 && (
          <span className="text-xs text-[var(--accent)] bg-[var(--accent-muted)] px-2 py-0.5 rounded-full">
            {pinnedIds.size} pinned
          </span>
        )}
        <span className="text-xs text-[var(--ink-muted)]">{insights.length} total</span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pr-2 -mr-2">
        {/* Pinned insights first */}
        {pinnedInsights.length > 0 && (
          <>
            <p className="text-xs text-[var(--ink-muted)] font-medium uppercase tracking-wide">
              Pinned
            </p>
            <AnimatePresence>
              {pinnedInsights.map(insight => (
                <InsightCard
                  key={insight.id}
                  insight={insight}
                  onPin={handlePin}
                  onUnpin={handleUnpin}
                />
              ))}
            </AnimatePresence>
            {unpinnedInsights.length > 0 && (
              <div className="border-t border-[var(--border-subtle)] my-3" />
            )}
          </>
        )}

        {/* Unpinned insights */}
        <AnimatePresence>
          {unpinnedInsights.map(insight => (
            <InsightCard
              key={insight.id}
              insight={insight}
              onPin={handlePin}
              onUnpin={handleUnpin}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
