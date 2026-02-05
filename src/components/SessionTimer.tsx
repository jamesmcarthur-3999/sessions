/**
 * SessionTimer
 *
 * Broadcast-style recording header with:
 * - "ON AIR" style recording indicator with glow
 * - Large broadcast clock timer
 * - Editable session title
 * - Instrument-panel style stats
 * - Professional control buttons
 */

import { useState, useRef, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Pause, Play, Square, Camera, Mic, Video, Edit3, Check, Radio } from 'lucide-react'

interface SessionTimerProps {
  /** Current duration in seconds */
  duration: number
  /** Is recording paused */
  isPaused: boolean
  /** Is session ending/processing */
  isEnding: boolean
  /** Session title */
  title: string
  /** Called when title changes */
  onTitleChange: (title: string) => void
  /** Called when pause/resume clicked */
  onPauseResume: () => void
  /** Called when stop clicked */
  onStop: () => void
  /** Screenshot count */
  screenshotCount?: number
  /** Transcription status */
  transcriptionStatus?: 'idle' | 'transcribing' | 'success' | 'error'
  /** Is video recording enabled */
  videoEnabled?: boolean
  /** Is audio enabled */
  audioEnabled?: boolean
  /** Current audio level (0-1) */
  audioLevel?: number
  /** Show confirmation bar instead of normal controls */
  showConfirmation?: boolean
  /** Called when confirmation is accepted */
  onConfirmEnd?: () => void
  /** Called when confirmation is cancelled */
  onCancelEnd?: () => void
}

function formatTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60

  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

export function SessionTimer({
  duration,
  isPaused,
  isEnding,
  title,
  onTitleChange,
  onPauseResume,
  onStop,
  screenshotCount = 0,
  transcriptionStatus = 'idle',
  videoEnabled = false,
  audioEnabled = false,
  audioLevel = 0,
  showConfirmation = false,
  onConfirmEnd,
  onCancelEnd,
}: SessionTimerProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editedTitle, setEditedTitle] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)
  const formattedTime = useMemo(() => formatTime(duration), [duration])

  // Sync edited title with prop
  useEffect(() => {
    if (!isEditingTitle) {
      setEditedTitle(title)
    }
  }, [title, isEditingTitle])

  const handleTitleClick = () => {
    setIsEditingTitle(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleTitleSubmit = () => {
    setIsEditingTitle(false)
    if (editedTitle.trim() && editedTitle !== title) {
      onTitleChange(editedTitle.trim())
    } else {
      setEditedTitle(title)
    }
  }

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleTitleSubmit()
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false)
      setEditedTitle(title)
    }
  }

  return (
    <div className="sticky top-0 z-30 bg-[var(--paper)]/95 backdrop-blur-sm border-b border-[var(--border-subtle)]">
      <div className="max-w-6xl mx-auto px-6 py-5">
        {/* Top row: ON AIR indicator + Controls */}
        <div className="flex items-center justify-between mb-6">
          {/* ON AIR Badge - Broadcast style */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center gap-3"
          >
            <motion.div
              animate={isPaused ? { opacity: 0.5 } : { opacity: 1 }}
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className={`
                relative flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm tracking-wide
                ${isPaused
                  ? 'bg-[var(--paper-dark)] text-[var(--ink-muted)]'
                  : 'bg-[var(--session-recording)] text-white'
                }
              `}
            >
              {/* Pulsing glow effect when recording */}
              {!isPaused && !isEnding && (
                <motion.div
                  animate={{ opacity: [0.4, 0.1, 0.4], scale: [1, 1.15, 1] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute inset-0 rounded-lg bg-[var(--session-recording)]"
                  style={{ filter: 'blur(8px)' }}
                />
              )}
              <motion.div
                animate={isPaused || isEnding ? {} : { opacity: [1, 0.3, 1] }}
                transition={{ duration: 1.2, repeat: Infinity }}
                className="relative"
              >
                <Radio className="w-4 h-4" />
              </motion.div>
              <span className="relative uppercase tracking-wider">
                {isEnding ? 'Processing' : isPaused ? 'Paused' : 'On Air'}
              </span>
              <span className="sr-only">
                {isEnding ? 'Session is processing' : isPaused ? 'Recording is paused' : 'Recording in progress'}
              </span>
            </motion.div>
          </motion.div>

          {/* Controls or Confirmation */}
          <AnimatePresence mode="wait">
            {showConfirmation ? (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, x: 20, scale: 0.95 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 20, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-3 px-5 py-3 rounded-xl bg-[var(--paper-warm)] border border-[var(--border-medium)] shadow-[var(--shadow-md)]"
              >
                <span className="text-sm font-medium text-[var(--ink)]">End this session?</span>
                <button
                  onClick={onCancelEnd}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--paper-dark)] transition-all duration-200"
                >
                  Keep Recording
                </button>
                <button
                  onClick={onConfirmEnd}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--session-recording)] text-white hover:bg-[var(--session-recording)]/90 transition-all duration-200 shadow-sm"
                >
                  End & Process
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="controls"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="flex items-center gap-2"
              >
                <motion.button
                  onClick={onPauseResume}
                  disabled={isEnding}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="p-3 rounded-xl bg-[var(--paper-warm)] hover:bg-[var(--paper-dark)] border border-[var(--border-subtle)] transition-all duration-200 disabled:opacity-50"
                  aria-label={isPaused ? 'Resume recording' : 'Pause recording'}
                >
                  {isPaused ? (
                    <Play className="w-5 h-5 text-[var(--ink)]" />
                  ) : (
                    <Pause className="w-5 h-5 text-[var(--ink)]" />
                  )}
                </motion.button>

                <motion.button
                  onClick={onStop}
                  disabled={isEnding}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="p-3 rounded-xl bg-[var(--session-recording)] hover:bg-[var(--session-recording)]/90 transition-all duration-200 disabled:opacity-50 shadow-lg shadow-[var(--session-recording)]/25"
                  aria-label="Stop recording"
                >
                  <Square className="w-5 h-5 text-white fill-white" />
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Broadcast Clock - The centerpiece */}
        <div className="text-center mb-5">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="inline-block"
          >
            <div
              className="font-mono text-6xl md:text-7xl lg:text-8xl font-light text-[var(--ink)] tracking-tighter"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formattedTime}
            </div>
          </motion.div>
        </div>

        {/* Session Title - Editable */}
        <div className="text-center mb-5">
          {isEditingTitle ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="inline-flex items-center gap-2"
            >
              <input
                ref={inputRef}
                type="text"
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                onBlur={handleTitleSubmit}
                onKeyDown={handleTitleKeyDown}
                className="bg-transparent text-center font-display text-xl text-[var(--ink)] placeholder:text-[var(--ink-muted)] outline-none border-b-2 border-[var(--accent)] pb-1 min-w-[240px]"
                aria-label="Session title"
              />
              <button
                onClick={handleTitleSubmit}
                className="p-1.5 rounded-lg hover:bg-[var(--paper-warm)] transition-colors"
              >
                <Check className="w-4 h-4 text-[var(--accent)]" />
              </button>
            </motion.div>
          ) : (
            <button
              onClick={handleTitleClick}
              className="inline-flex items-center gap-2 font-display text-xl text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors group"
            >
              <span>{title}</span>
              <Edit3 className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )}
        </div>

        {/* Stats Instrument Panel */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex items-center justify-center gap-1"
        >
          {/* Screenshots Indicator */}
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--paper-warm)] border border-[var(--border-subtle)]">
            <Camera className="w-4 h-4 text-[var(--success)]" />
            <span className="text-sm font-medium text-[var(--ink)] tabular-nums">{screenshotCount}</span>
            <span className="text-xs text-[var(--ink-muted)]">captures</span>
          </div>

          {/* Audio/Transcription Indicator */}
          {audioEnabled && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--paper-warm)] border border-[var(--border-subtle)]">
              <Mic
                className={`w-4 h-4 transition-colors ${
                  transcriptionStatus === 'error'
                    ? 'text-[var(--error)]'
                    : transcriptionStatus === 'transcribing'
                      ? 'text-[var(--accent)]'
                      : audioLevel > 0.1
                        ? 'text-[var(--success)]'
                        : 'text-[var(--ink-muted)]'
                }`}
              />
              {/* VU Meter style bars */}
              <div className="flex items-end gap-[2px] h-4">
                {[0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((threshold, i) => (
                  <motion.div
                    key={threshold}
                    animate={{
                      scaleY: audioLevel >= threshold ? 1 : 0.3,
                      opacity: audioLevel >= threshold ? 1 : 0.3
                    }}
                    transition={{ duration: 0.1 }}
                    className={`w-[3px] rounded-full origin-bottom ${
                      i >= 4
                        ? audioLevel >= threshold ? 'bg-[var(--session-recording)]' : 'bg-[var(--border-medium)]'
                        : audioLevel >= threshold ? 'bg-[var(--success)]' : 'bg-[var(--border-medium)]'
                    }`}
                    style={{ height: `${8 + i * 2}px` }}
                  />
                ))}
              </div>
              <span className="text-xs text-[var(--ink-muted)]">
                {transcriptionStatus === 'transcribing' ? 'Transcribing' : 'Audio'}
              </span>
            </div>
          )}

          {/* Video Indicator */}
          {videoEnabled && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--paper-warm)] border border-[var(--border-subtle)]">
              <Video className="w-4 h-4 text-[var(--session-recording)]" />
              <span className="text-xs text-[var(--ink-muted)]">Video</span>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  )
}
