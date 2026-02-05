/**
 * InsightCard
 *
 * Individual AI insight card with pin functionality.
 * Different styling based on insight type.
 */

import { useState, memo } from 'react'
import { motion } from 'framer-motion'
import { Pin, CheckSquare, Bell, Lightbulb, FileText } from 'lucide-react'

export interface Insight {
  id: string
  type: 'task' | 'follow-up' | 'key-insight' | 'summary'
  content: string
  timestamp: Date
  isPinned?: boolean
}

interface InsightCardProps {
  insight: Insight
  onPin: (id: string) => void
  onUnpin: (id: string) => void
}

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export const InsightCard = memo(function InsightCard({ insight, onPin, onUnpin }: InsightCardProps) {
  const [isHovered, setIsHovered] = useState(false)

  const getTypeConfig = (type: Insight['type']) => {
    switch (type) {
      case 'task':
        return {
          icon: CheckSquare,
          label: 'Task Detected',
          bgColor: 'bg-[var(--warning-muted)]',
          borderColor: 'border-[var(--warning)]/20',
          iconColor: 'text-[var(--warning)]',
        }
      case 'follow-up':
        return {
          icon: Bell,
          label: 'Follow-up Needed',
          bgColor: 'bg-[var(--session-capture-muted)]',
          borderColor: 'border-[var(--session-capture)]/20',
          iconColor: 'text-[var(--session-capture)]',
        }
      case 'key-insight':
        return {
          icon: Lightbulb,
          label: 'Key Insight',
          bgColor: 'bg-[var(--accent-muted)]',
          borderColor: 'border-[var(--accent)]/20',
          iconColor: 'text-[var(--accent)]',
        }
      case 'summary':
        return {
          icon: FileText,
          label: 'Summary Update',
          bgColor: 'bg-[var(--paper-warm)]',
          borderColor: 'border-[var(--border-subtle)]',
          iconColor: 'text-[var(--ink-muted)]',
        }
      default:
        return {
          icon: Lightbulb,
          label: 'Insight',
          bgColor: 'bg-[var(--paper-warm)]',
          borderColor: 'border-[var(--border-subtle)]',
          iconColor: 'text-[var(--ink-muted)]',
        }
    }
  }

  const config = getTypeConfig(insight.type)
  const Icon = config.icon

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`
        relative p-4 rounded-xl border
        ${config.bgColor} ${config.borderColor}
        ${insight.isPinned ? 'ring-2 ring-[var(--accent)]' : ''}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${config.iconColor}`} />
          <span className={`text-xs font-medium ${config.iconColor}`}>
            {config.label}
          </span>
        </div>
        <span className="text-xs text-[var(--ink-muted)]">
          {formatRelativeTime(insight.timestamp)}
        </span>
      </div>

      {/* Content */}
      <p className="text-sm text-[var(--ink)] leading-relaxed">
        {insight.content}
      </p>

      {/* Pin button */}
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: isHovered || insight.isPinned ? 1 : 0 }}
        onClick={() => insight.isPinned ? onUnpin(insight.id) : onPin(insight.id)}
        className={`
          absolute bottom-3 right-3 p-1.5 rounded-lg transition-colors
          ${insight.isPinned
            ? 'bg-[var(--accent)] text-white'
            : 'bg-[var(--paper)] text-[var(--ink-muted)] hover:text-[var(--accent)] hover:bg-[var(--paper-warm)]'
          }
        `}
        title={insight.isPinned ? 'Unpin from summary' : 'Pin to summary'}
      >
        <Pin className="w-3.5 h-3.5" />
      </motion.button>
    </motion.div>
  )
})
