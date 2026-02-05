/**
 * SessionSetup
 *
 * Inline recording setup component (replaces modal).
 * Provides screen and microphone selection with a streamlined flow.
 */

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Video, AlertCircle, Sparkles } from 'lucide-react'
import { ScreenPicker } from './ScreenPicker'
import { MicSelector } from './MicSelector'
import { hasApiKey } from '../services/bots'
import { getSecureItem } from '../services/secure-storage'
import type { RecordingConfig } from '../types'

interface SessionSetupProps {
  /** Called when user wants to go back */
  onBack: () => void
  /** Called when user starts recording with the config */
  onStartRecording: (config: RecordingConfig) => void
}

// Animation variants per design spec
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] as const },
  },
}

export function SessionSetup({ onBack, onStartRecording }: SessionSetupProps) {
  // Recording config state
  const [selectedScreens, setSelectedScreens] = useState<string[]>([])
  const [selectedMicrophone, setSelectedMicrophone] = useState<string | null>(null)

  // API key checks
  const [hasClaudeKey, setHasClaudeKey] = useState(false)
  const [hasOpenaiKey, setHasOpenaiKey] = useState(false)

  // Check API keys on mount
  useEffect(() => {
    hasApiKey().then(setHasClaudeKey)
    getSecureItem('sessions_openai_api_key').then(key => setHasOpenaiKey(!!key))
  }, [])

  // Build the config for the Start button context text
  const screenCount = selectedScreens.length
  const hasAudio = selectedMicrophone !== null

  // Context text for start button
  const getContextText = (): string => {
    if (screenCount === 0) return ''

    const screenText = screenCount === 1 ? 'your screen' : `${screenCount} screens`
    const audioText = hasAudio ? 'with audio' : 'without audio'

    return `Recording ${screenText} ${audioText}`
  }

  // Can start recording?
  const canStart = screenCount > 0

  // Handle start recording
  const handleStart = () => {
    if (!canStart) return

    const config: RecordingConfig = {
      selectedScreens,
      selectedMicrophone,
    }

    onStartRecording(config)
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="min-h-screen flex flex-col bg-[var(--paper)] texture-grain"
    >
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-5 border-b border-[var(--border-subtle)]">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors duration-200"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm">Back</span>
        </button>

        {/* Keyboard hint */}
        <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
          <span className="kbd">Esc</span>
          <span>to cancel</span>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex flex-col max-w-2xl mx-auto w-full px-6 py-10">
        {/* Title section */}
        <motion.div variants={itemVariants} className="flex items-center gap-4 mb-10">
          <div className="w-14 h-14 rounded-xl bg-[var(--session-recording-muted)] flex items-center justify-center">
            <Video className="w-7 h-7 text-[var(--session-recording)]" />
          </div>
          <div>
            <h1 className="text-2xl font-medium text-[var(--ink)]">Record Session</h1>
            <p className="text-sm text-[var(--ink-muted)]">
              Choose what to capture — AI handles the rest
            </p>
          </div>
        </motion.div>

        {/* API key warnings */}
        {!hasClaudeKey && (
          <motion.div
            variants={itemVariants}
            className="mb-6 flex items-start gap-3 p-4 rounded-xl bg-[var(--warning-muted)] border border-[var(--warning)]/30"
          >
            <AlertCircle className="w-5 h-5 text-[var(--warning)] flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-[var(--warning-text)]">
                AI features require Claude API key
              </p>
              <p className="text-xs text-[var(--warning)] mt-1">
                You'll get recording but no intelligent summaries. Add your key in Settings.
              </p>
            </div>
          </motion.div>
        )}

        {hasAudio && !hasOpenaiKey && (
          <motion.div
            variants={itemVariants}
            className="mb-6 flex items-start gap-3 p-4 rounded-xl bg-[var(--warning-muted)] border border-[var(--warning)]/30"
          >
            <AlertCircle className="w-5 h-5 text-[var(--warning)] flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-[var(--warning-text)]">
                Audio transcription requires OpenAI API key
              </p>
              <p className="text-xs text-[var(--warning)] mt-1">
                Audio will be recorded but not transcribed.
              </p>
            </div>
          </motion.div>
        )}

        {/* Screen picker */}
        <motion.div variants={itemVariants} className="mb-8">
          <ScreenPicker
            selectedScreens={selectedScreens}
            onSelectionChange={setSelectedScreens}
          />
        </motion.div>

        {/* Divider */}
        <motion.div
          variants={itemVariants}
          className="border-t border-[var(--border-subtle)] mb-8"
        />

        {/* Microphone selector */}
        <motion.div variants={itemVariants} className="mb-10">
          <MicSelector
            selectedMicrophone={selectedMicrophone}
            onMicrophoneChange={setSelectedMicrophone}
          />
        </motion.div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Start button */}
        <motion.div variants={itemVariants} className="pt-6 border-t border-[var(--border-subtle)]">
          <motion.button
            onClick={handleStart}
            disabled={!canStart}
            whileHover={canStart ? { scale: 1.01 } : undefined}
            whileTap={canStart ? { scale: 0.99 } : undefined}
            className={`
              w-full py-4 rounded-xl font-medium text-lg transition-all duration-200
              ${canStart
                ? 'bg-[var(--session-recording)] text-white shadow-[var(--shadow-lg)] hover:shadow-[var(--shadow-xl)]'
                : 'bg-[var(--paper-dark)] text-[var(--ink-muted)] cursor-not-allowed'
              }
            `}
          >
            <div className="flex items-center justify-center gap-3">
              <Video className="w-5 h-5" />
              <span>Start Recording</span>
            </div>
          </motion.button>

          {/* Context text */}
          {canStart && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center text-sm text-[var(--ink-muted)] mt-3 flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4 text-[var(--accent)]" />
              {getContextText()}
            </motion.p>
          )}
        </motion.div>
      </div>

      {/* Footer hint */}
      <footer className="px-6 py-4 border-t border-[var(--border-subtle)]">
        <p className="text-center text-xs text-[var(--ink-muted)]">
          Screenshots, analysis, and insights are automatic — just focus on your work
        </p>
      </footer>
    </motion.div>
  )
}
