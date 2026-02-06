/**
 * SessionRecording
 *
 * Live session recording view with real-time dashboard.
 * All logic is in useRecordingSession hook — this component is pure UI.
 */

import { useState, useEffect } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { SessionTimer } from './SessionTimer'
import { LiveDashboard } from './LiveDashboard'
import { requestScreenRecordingPermission } from '../services/recording'
import { useToast } from './Toast'
import { useRecordingSession, type RecordingHealthState } from '../hooks/useRecordingSession'
import type { Session } from '../types'

interface SessionRecordingProps {
  onComplete: (session: Session) => void
  onCancel: () => void
}

// ============================================================================
// Recording Health Status Bar
// ============================================================================

interface RecordingHealthBarProps {
  health: RecordingHealthState
  screenshotCount: number
  recordingStartTime: number | null
  audioEnabled: boolean
}

function RecordingHealthBar({ health, screenshotCount, recordingStartTime, audioEnabled }: RecordingHealthBarProps) {
  const [visible, setVisible] = useState(true)

  // Auto-hide after 30s if everything is healthy
  useEffect(() => {
    if (!recordingStartTime) return
    const allHealthy = health.workerReady && health.hasApiKey && health.screenshotsActive && !health.lastError
    if (!allHealthy) return

    const timeout = setTimeout(() => setVisible(false), 30000)
    return () => clearTimeout(timeout)
  }, [recordingStartTime, health.workerReady, health.hasApiKey, health.screenshotsActive, health.lastError])

  // Show again if something goes wrong
  useEffect(() => {
    if (health.lastError) setVisible(true)
  }, [health.lastError])

  if (!visible || !recordingStartTime) return null

  const allHealthy = health.workerReady && health.hasApiKey && health.screenshotsActive && !health.lastError

  return (
    <div role="status" aria-live="polite" className={`px-4 py-2 border-b flex items-center gap-3 text-xs font-mono ${
      allHealthy
        ? 'border-[var(--border-subtle)] bg-[var(--paper)]'
        : 'border-[var(--error)]/20 bg-[var(--error-muted)]'
    }`}>
      <HealthIndicator label="Worker" ok={health.workerReady} detail={health.workerReady ? undefined : 'Not initialized'} />
      <HealthIndicator label="API Key" ok={health.hasApiKey} detail={health.hasApiKey ? undefined : 'Missing'} />
      {audioEnabled && (
        <HealthIndicator label="OpenAI Key" ok={health.hasOpenAiKey} detail={health.hasOpenAiKey ? undefined : 'Missing'} />
      )}
      <HealthIndicator
        label="Screenshots"
        ok={health.screenshotsActive}
        detail={health.screenshotsActive ? `${screenshotCount}` : 'None'}
      />
      {audioEnabled && (
        <HealthIndicator label="Audio" ok={health.audioActive} detail={health.audioActive ? undefined : 'Inactive'} />
      )}
      {health.lastError && (
        <span className="text-[var(--error)] truncate max-w-xs" title={health.lastError}>
          {health.lastError}
        </span>
      )}
      {allHealthy && (
        <button
          onClick={() => setVisible(false)}
          className="ml-auto text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors"
          aria-label="Dismiss status bar"
        >
          dismiss
        </button>
      )}
    </div>
  )
}

function HealthIndicator({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${ok ? 'text-green-600' : 'text-[var(--error)]'}`}>
      <span>{ok ? '\u2713' : '\u2717'}</span>
      <span>{label}</span>
      {detail && <span className="text-[var(--ink-muted)]">({detail})</span>}
    </span>
  )
}

// ============================================================================
// SessionRecording Component
// ============================================================================

export function SessionRecording({ onComplete, onCancel }: SessionRecordingProps) {
  const { showToast } = useToast()
  const prefersReducedMotion = useReducedMotion()

  const {
    isPaused,
    isEnding,
    showConfirmation,
    processingStep,
    processingPercent,
    duration,
    sessionTitle,
    screenshotCount,
    permissionError,
    fatalError,
    recordingStartTime,
    recordingHealth,
    audioEnabled,
    audioLevel,
    transcriptionStatus,
    sessionId,
    recordingStarted,
    handlePauseResume,
    handleEndSession,
    handleTitleChange,
    setShowConfirmation,
    handleGoBack,
    handleRetry,
    handleSavePartial,
  } = useRecordingSession(onComplete, onCancel, showToast)

  // Permission error state
  if (permissionError) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="min-h-screen flex items-center justify-center bg-[var(--paper)] p-6"
      >
        <div className="max-w-md text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-[var(--error-muted)] flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-[var(--error)]" />
          </div>
          <h2 className="text-2xl font-medium text-[var(--ink)] mb-3">
            Permission Required
          </h2>
          <p className="text-[var(--ink-muted)] mb-6">
            {permissionError}
          </p>
          <div className="flex gap-4 justify-center">
            <button
              onClick={onCancel}
              className="px-5 py-2.5 rounded-xl border border-[var(--border-medium)] text-[var(--ink)] hover:bg-[var(--paper-warm)] transition-colors"
            >
              Go Back
            </button>
            <button
              onClick={() => requestScreenRecordingPermission().then(() => window.location.reload())}
              className="px-5 py-2.5 rounded-xl bg-[var(--accent)] text-white hover:bg-[var(--accent-light)] transition-colors"
            >
              Grant Permission
            </button>
          </div>
        </div>
      </motion.div>
    )
  }

  // Fatal error state
  if (fatalError) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="min-h-screen flex items-center justify-center bg-[var(--paper)] p-6"
      >
        <div className="max-w-md text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-[var(--error-muted)] flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-[var(--error)]" />
          </div>
          <h2 className="text-2xl font-medium text-[var(--ink)] mb-3">
            {recordingStarted ? 'Recording Error' : 'Failed to Start'}
          </h2>
          <p className="text-[var(--ink-muted)] mb-6">
            {fatalError}
          </p>
          <div className="flex flex-col gap-3">
            <div className="flex gap-3 justify-center">
              <button
                onClick={handleRetry}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--accent)] text-white hover:bg-[var(--accent-light)] transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Try Again
              </button>
              <button
                onClick={handleGoBack}
                className="px-5 py-2.5 rounded-xl border border-[var(--border-medium)] text-[var(--ink)] hover:bg-[var(--paper-warm)] transition-colors"
              >
                Go Back
              </button>
            </div>
            {recordingStarted && (
              <button
                onClick={handleSavePartial}
                className="px-5 py-2.5 rounded-xl text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--paper-warm)] transition-colors text-sm"
              >
                Save partial recording
              </button>
            )}
          </div>
        </div>
      </motion.div>
    )
  }

  // Processing state
  if (isEnding) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="min-h-screen flex items-center justify-center bg-[var(--paper)] p-6"
      >
        <div className="text-center max-w-md">
          {/* Processing animation */}
          <div className="relative w-24 h-24 mx-auto mb-8">
            <motion.div
              animate={prefersReducedMotion ? {} : { rotate: 360 }}
              transition={prefersReducedMotion ? {} : { duration: 8, repeat: Infinity, ease: 'linear' }}
              className="absolute inset-0"
            >
              <div className="absolute inset-0 rounded-full border border-[var(--accent)]/30" />
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-[var(--accent)]" />
            </motion.div>
            <motion.div
              animate={prefersReducedMotion ? {} : { rotate: -360 }}
              transition={prefersReducedMotion ? {} : { duration: 5, repeat: Infinity, ease: 'linear' }}
              className="absolute inset-4"
            >
              <div className="absolute inset-0 rounded-full border border-[var(--accent)]/40" />
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-[var(--accent)]" />
            </motion.div>
            <motion.div
              animate={prefersReducedMotion ? {} : { scale: [0.8, 1, 0.8], opacity: [0.6, 1, 0.6] }}
              transition={prefersReducedMotion ? {} : { duration: 2, repeat: Infinity }}
              className="absolute inset-8 rounded-full bg-[var(--accent)]"
            />
          </div>

          <h2 className="text-xl font-medium text-[var(--ink)] mb-3">
            {processingStep || 'Processing your session'}
          </h2>

          {/* Progress bar */}
          <div className="w-full max-w-xs mx-auto mb-4">
            <div className="h-1.5 bg-[var(--paper-dark)] rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-[var(--accent)]"
                initial={{ width: 0 }}
                animate={{ width: `${processingPercent}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <p className="text-xs text-[var(--ink-muted)] mt-2">{processingPercent}%</p>
          </div>

          <p className="text-sm text-[var(--ink-muted)]">
            Analyzing {Math.floor(duration / 60)} minutes of work
          </p>
        </div>
      </motion.div>
    )
  }

  // Main recording view
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen flex flex-col bg-[var(--paper)]"
    >
      {/* Fixed timer header */}
      <SessionTimer
        duration={duration}
        isPaused={isPaused}
        isEnding={isEnding}
        title={sessionTitle}
        onTitleChange={handleTitleChange}
        onPauseResume={handlePauseResume}
        onStop={() => setShowConfirmation(true)}
        screenshotCount={screenshotCount}
        transcriptionStatus={transcriptionStatus}
        videoEnabled={true}
        audioEnabled={audioEnabled}
        audioLevel={audioLevel}
        showConfirmation={showConfirmation}
        onConfirmEnd={handleEndSession}
        onCancelEnd={() => setShowConfirmation(false)}
      />

      {/* Recording health status bar */}
      <RecordingHealthBar
        health={recordingHealth}
        screenshotCount={screenshotCount}
        recordingStartTime={recordingStartTime}
        audioEnabled={audioEnabled}
      />

      {/* Scrollable dashboard */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto h-full">
          <LiveDashboard
            sessionId={sessionId}
            audioEnabled={audioEnabled}
          />
        </div>
      </div>

      {/* Keyboard hints footer */}
      <footer className="px-6 py-3 border-t border-[var(--border-subtle)]">
        <div className="flex items-center justify-center gap-6 text-xs text-[var(--ink-muted)]">
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-[var(--paper-dark)]">Space</kbd>
            {isPaused ? 'Resume' : 'Pause'}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded bg-[var(--paper-dark)]">⌘↵</kbd>
            End
          </span>
        </div>
      </footer>
    </motion.div>
  )
}
