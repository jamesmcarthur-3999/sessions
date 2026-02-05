/**
 * LiveDashboard
 *
 * Control room-style dashboard for live session monitoring.
 * Three distinct panel types with visual hierarchy.
 */

import { motion } from 'framer-motion'
import { Activity, MessageSquare, Sparkles } from 'lucide-react'
import { ActivityFeed } from './ActivityFeed'
import { LiveTranscript } from './LiveTranscript'
import { InsightsPanel } from './InsightsPanel'

interface LiveDashboardProps {
  sessionId: string
  audioEnabled: boolean
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.15,
    },
  },
}

const panelVariants = {
  hidden: { opacity: 0, y: 24, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const },
  },
}

interface PanelProps {
  children: React.ReactNode
  title: string
  icon: React.ReactNode
  accentColor?: string
  className?: string
}

function Panel({ children, title, icon, accentColor = 'var(--ink-muted)', className = '' }: PanelProps) {
  return (
    <motion.div
      variants={panelVariants}
      className={`
        relative flex flex-col rounded-2xl bg-[var(--paper)]
        border border-[var(--border-subtle)] overflow-hidden
        shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)] transition-shadow duration-300
        ${className}
      `}
    >
      {/* Panel Header - Consistent styling */}
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-[var(--border-subtle)] bg-[var(--paper-warm)]">
        <div
          className="flex items-center justify-center w-6 h-6 rounded-md"
          style={{ backgroundColor: `color-mix(in srgb, ${accentColor} 15%, transparent)` }}
        >
          <div style={{ color: accentColor }}>{icon}</div>
        </div>
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
          {title}
        </span>
      </div>

      {/* Panel Content */}
      <div className="flex-1 p-5 overflow-hidden">
        {children}
      </div>
    </motion.div>
  )
}

export function LiveDashboard({ sessionId, audioEnabled }: LiveDashboardProps) {
  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="flex-1 overflow-hidden"
    >
      {/* Responsive grid: single column on mobile, 60/40 split on large screens */}
      <div className="h-full grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-5">
        {/* Left column: Activity + Transcript (stacked) */}
        <div className="flex flex-col gap-5 min-h-0 overflow-hidden">
          {/* Activity Feed Panel */}
          <Panel
            title="Activity"
            icon={<Activity className="w-3.5 h-3.5" />}
            accentColor="#3b82f6"
            className="flex-1 min-h-[180px] max-h-[45%]"
          >
            <ActivityFeed sessionId={sessionId} />
          </Panel>

          {/* Live Transcript Panel */}
          <Panel
            title="Transcript"
            icon={<MessageSquare className="w-3.5 h-3.5" />}
            accentColor="#8b5cf6"
            className="flex-1 min-h-[180px]"
          >
            <LiveTranscript
              sessionId={sessionId}
              audioEnabled={audioEnabled}
            />
          </Panel>
        </div>

        {/* Right column: Insights - The star panel */}
        <Panel
          title="AI Insights"
          icon={<Sparkles className="w-3.5 h-3.5" />}
          accentColor="var(--accent)"
          className="min-h-[300px] xl:h-auto"
        >
          <InsightsPanel sessionId={sessionId} />
        </Panel>
      </div>
    </motion.div>
  )
}
