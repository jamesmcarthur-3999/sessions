import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Square, Pause, Play, Camera, Mic, AlertCircle, Video, Monitor, Sparkles } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { sessionRecorder, isTauri, checkScreenRecordingPermission, requestScreenRecordingPermission, type RecordingOptions } from '../services/recording'
import { createSession, updateSessionStatus, getRollingSummary, getInsights, getAudioChunks, getScreenshots } from '../services/database'
import { sessionCoordinator } from '../services/session-coordinator'
import { smartCapture } from '../services/smart-capture'
import { createFinalSummaryBot, buildFinalSummaryInput, initializeBots, isBotsReady } from '../services/bots'
import { generateId } from '../utils/id'
import { useSessionIntelligence } from '../hooks/useSessionIntelligence'
import { LiveSessionPanel } from './LiveSessionPanel'
import { PeripheralGlow } from './PeripheralGlow'
import { useToast } from './Toast'
import { ConfirmDialog } from './ConfirmDialog'
import type { Session, Summary } from '../types'

interface SessionRecordingProps {
  onComplete: (session: Session) => void
  onCancel: () => void
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

export function SessionRecording({ onComplete, onCancel }: SessionRecordingProps) {
  const { state, addSession, dispatch } = useApp()
  const { showToast } = useToast()
  const [isPaused, setIsPaused] = useState(false)
  const [isEnding, setIsEnding] = useState(false)
  const [showEndConfirm, setShowEndConfirm] = useState(false)
  const [processingStep, setProcessingStep] = useState<string>('')
  const [processingPercent, setProcessingPercent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [sessionTitle, setSessionTitle] = useState('')
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [screenshotCount, setScreenshotCount] = useState(0)
  const [permissionError, setPermissionError] = useState<string | null>(null)
  const [fatalError, setFatalError] = useState<string | null>(null)
  const [showIntelligence, setShowIntelligence] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)
  const [transcriptionStatus, setTranscriptionStatus] = useState<'idle' | 'transcribing' | 'success' | 'error'>('idle')
  const [captureFlash, setCaptureFlash] = useState(false)
  const startTimeRef = useRef(Date.now())
  const pausedTimeRef = useRef(0)
  const pauseStartRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const sessionIdRef = useRef(generateId())
  const isPausedRef = useRef(false)

  // Get session intelligence state
  const { analysisMode } = useSessionIntelligence(sessionIdRef.current)

  // Get recording config from active session
  const recordingConfig = state.activeSession?.recordingConfig

  // Keep isPausedRef in sync with state for use in event listeners
  useEffect(() => {
    isPausedRef.current = isPaused
  }, [isPaused])

  // Check permissions and start recording on mount
  useEffect(() => {
    async function initRecording() {
      // Generate default title
      const now = new Date()
      const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      setSessionTitle(`Session at ${timeStr}`)

      // Convert RecordingConfig to RecordingOptions
      const recordingOptions: Partial<RecordingOptions> = recordingConfig ? {
        enableScreenshots: recordingConfig.enableScreenshots,
        enableAudio: recordingConfig.enableAudio,
        enableVideo: recordingConfig.enableVideo,
        screenshotIntervalMs: recordingConfig.screenshotInterval * 60 * 1000, // Convert minutes to ms
        selectedMicrophone: recordingConfig.selectedMicrophone,
        selectedScreen: recordingConfig.selectedScreen,
        smartCaptureEnabled: recordingConfig.smartCaptureEnabled,
      } : {}

      // Determine initial analysis mode from config
      // 'adaptive' starts in 'ambient' and AI adjusts; otherwise use user selection
      const initialAnalysisMode: 'ambient' | 'deep' =
        recordingConfig?.analysisMode === 'adaptive' || recordingConfig?.analysisMode === 'ambient'
          ? 'ambient'
          : recordingConfig?.analysisMode === 'deep' ? 'deep' : 'ambient'

      // Check if we're in Tauri
      if (isTauri()) {
        try {
          // Permission already validated in RecordingSettings
          // Just verify it's still valid (edge case: user revoked mid-transition)
          const permitted = await checkScreenRecordingPermission()
          if (!permitted) {
            setPermissionError('Screen recording permission was revoked. Please grant permission again.')
            return
          }

          // Start recording with config options
          const result = await sessionRecorder.startRecording(sessionIdRef.current, recordingOptions)

          // Show warnings for partial failures
          if (result.errors.length > 0) {
            for (const error of result.errors) {
              showToast(error, 'error', 5000)
            }
          }

          // Create database session with the same ID as the recording
          await createSession(sessionIdRef.current, 'session', sessionTitle, initialAnalysisMode)

          // Start session coordinator for AI analysis
          await sessionCoordinator.startSession(sessionIdRef.current)
        } catch (e) {
          console.error('Failed to start recording:', e)
          setPermissionError(e instanceof Error ? e.message : 'Failed to start recording')
        }
      } else {
        // Not in Tauri - browser only mode
        console.log('Running in browser mode - no native recording')
      }
    }

    initRecording()

    // Cleanup on unmount
    return () => {
      const cleanup = async () => {
        try {
          if (sessionRecorder.isRecording()) {
            await sessionRecorder.stopRecording()
          }
        } catch (err) {
          console.error('Failed to stop recording:', err)
        }
        try {
          await sessionCoordinator.stopSession(sessionIdRef.current)
        } catch (err) {
          console.error('Failed to stop coordinator:', err)
        }
      }
      cleanup()
    }
  }, [recordingConfig])

  // Timer
  useEffect(() => {
    if (isPaused || isEnding) return

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current - pausedTimeRef.current) / 1000)
      setDuration(elapsed)

      // Update screenshot count
      const state = sessionRecorder.getState()
      if (state) {
        setScreenshotCount(state.screenshots.length)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [isPaused, isEnding])

  // Listen for capture events (immediate) from smart capture
  useEffect(() => {
    const unsubCapture = smartCapture.on('capture', () => {
      setCaptureFlash(true)
      setTimeout(() => setCaptureFlash(false), 100)
    })

    return () => {
      unsubCapture()
    }
  }, [])

  // Listen for real-time audio level events from Rust
  // Note: isPaused is checked via ref inside callback to avoid listener remounting
  useEffect(() => {
    if (!isTauri() || !recordingConfig?.enableAudio) {
      setAudioLevel(0) // Immediately reset when audio disabled
      return
    }

    let unlisten: (() => void) | null = null

    const setupListener = async () => {
      const { listen } = await import('@tauri-apps/api/event')
      unlisten = await listen<{ level: number }>('audio-level', (event) => {
        // Check pause state via ref to avoid effect remount on pause toggle
        if (!isPausedRef.current) {
          setAudioLevel(event.payload.level)
        }
      })
    }

    setupListener()

    return () => {
      unlisten?.()
      setAudioLevel(0)
    }
  }, [recordingConfig?.enableAudio]) // isPaused intentionally excluded - uses ref

  // Listen for coordinator events (errors and transcription status)
  useEffect(() => {
    const unsubError = sessionCoordinator.on('error', ({ error }) => {
      showToast(error, 'error', 5000)

      // Track transcription errors
      if (error.includes('transcription')) {
        setTranscriptionStatus('error')
      }
    })

    const unsubTranscriptionStart = sessionCoordinator.on('transcription-start', () => {
      setTranscriptionStatus('transcribing')
    })

    const unsubTranscriptionComplete = sessionCoordinator.on('transcription-complete', () => {
      setTranscriptionStatus('success')
      // Reset to idle after showing success briefly
      setTimeout(() => setTranscriptionStatus('idle'), 2000)
    })

    return () => {
      unsubError()
      unsubTranscriptionStart()
      unsubTranscriptionComplete()
    }
  }, [showToast])

  const handlePauseResume = useCallback(async () => {
    if (isPaused) {
      // Resume - add paused duration to total paused time
      pausedTimeRef.current += Date.now() - pauseStartRef.current
      try {
        await sessionRecorder.resumeRecording()
        sessionCoordinator.resumeSession(sessionIdRef.current)
      } catch (e) {
        console.error('Failed to resume:', e)
      }
    } else {
      // Pause - record when pause started
      pauseStartRef.current = Date.now()
      try {
        await sessionRecorder.pauseRecording()
        sessionCoordinator.pauseSession(sessionIdRef.current)
      } catch (e) {
        console.error('Failed to pause:', e)
      }
    }
    setIsPaused(prev => !prev)
  }, [isPaused])

  const handleEndSession = useCallback(async () => {
    setIsEnding(true)
    setProcessingStep('Stopping recording...')
    setProcessingPercent(10)

    try {
      // Stop session coordinator
      setProcessingStep('Stopping AI analysis...')
      setProcessingPercent(20)
      await sessionCoordinator.stopSession(sessionIdRef.current)

      // Stop recording and get captured data
      setProcessingStep('Finalizing captures...')
      setProcessingPercent(30)
      let screenshots: string[] = []
      let stopWarnings: string[] = []
      if (sessionRecorder.isRecording()) {
        const recordingState = await sessionRecorder.stopRecording()
        screenshots = recordingState.screenshots
        stopWarnings = (recordingState as any).stopErrors || []
        console.log('Captured ' + screenshots.length + ' screenshots')

        // Show warnings for stop errors (but continue processing)
        if (stopWarnings.length > 0) {
          for (const warning of stopWarnings) {
            showToast(warning, 'error', 5000)
          }
        }
      }

      // Update database session status
      setProcessingStep('Gathering session data...')
      setProcessingPercent(40)
      await updateSessionStatus(sessionIdRef.current, 'processing', duration)

      // Gather all Baleybots intelligence from the database
      setProcessingPercent(50)
      const [rollingSummary, insights, audioChunks, dbScreenshots] = await Promise.all([
        getRollingSummary(sessionIdRef.current),
        getInsights(sessionIdRef.current),
        getAudioChunks(sessionIdRef.current),
        getScreenshots(sessionIdRef.current),
      ])

      // Generate final summary using Baleybots
      setProcessingStep('Generating AI summary...')
      setProcessingPercent(60)
      let summary: Summary

      // Ensure bots are initialized
      await initializeBots()

      // Check if we have enough content for AI processing
      const hasContent =
        rollingSummary?.content ||
        (insights && insights.length > 0) ||
        (audioChunks && audioChunks.some(c => c.transcript)) ||
        (dbScreenshots && dbScreenshots.some(s => s.analysis))

      if (isBotsReady() && (hasContent || duration >= 60)) {
        // Use Final Summary Bot with all accumulated intelligence
        const finalBot = createFinalSummaryBot()
        const input = buildFinalSummaryInput({
          rollingSummary,
          insights: insights || [],
          audioChunks: audioChunks || [],
          screenshots: dbScreenshots || [],
          durationSeconds: duration,
          title: sessionTitle || 'Untitled Session',
        })

        setProcessingPercent(70)
        const result = await finalBot.process(input)

        summary = {
          text: result?.text || 'Session completed.',
          tasks: (result?.tasks || []).map((t) => ({
            id: generateId(),
            title: t?.title || 'Untitled task',
            completed: false,
          })),
          notes: (result?.notes || []).map((n) => ({
            id: generateId(),
            content: n?.content || '',
          })),
          generatedAt: new Date().toISOString(),
        }
      } else {
        // Fallback when no API key or insufficient content
        const fallbackText = !isBotsReady()
          ? `Session recorded for ${Math.floor(duration / 60)} minutes. Configure your Claude API key in Settings to enable AI-powered summaries.`
          : duration < 60
          ? `Brief session recorded for ${duration} seconds. No significant activity captured.`
          : rollingSummary?.content || `Session recorded for ${Math.floor(duration / 60)} minutes.`

        summary = {
          text: fallbackText,
          tasks: [],
          notes: (insights || []).slice(0, 5).map(i => ({
            id: generateId(),
            content: i.content,
          })),
          generatedAt: new Date().toISOString(),
        }
      }

      // Update database session status to complete
      setProcessingStep('Saving session...')
      setProcessingPercent(90)
      await updateSessionStatus(sessionIdRef.current, 'complete', duration)

      // Create session
      const session: Session = {
        id: sessionIdRef.current,
        type: 'session',
        title: sessionTitle || 'Untitled Session',
        createdAt: new Date().toISOString(),
        duration,
        summary,
      }

      // Save and navigate
      await addSession(session)

      setProcessingStep('Complete!')
      setProcessingPercent(100)

      dispatch({ type: 'STOP_RECORDING' })
      onComplete(session)
    } catch (error) {
      console.error('Failed to end session:', error)

      // Update database status to error state
      try {
        await updateSessionStatus(sessionIdRef.current, 'error', duration)
      } catch (dbError) {
        console.error('Failed to update session status:', dbError)
      }

      // Determine specific error message
      let errorMessage = 'Failed to process session.'
      if (error instanceof Error) {
        if (error.message.includes('API key')) {
          errorMessage = 'AI summary failed. Please check your API key in Settings.'
        } else if (error.message.includes('database') || error.message.includes('SQL')) {
          errorMessage = 'Failed to save session data. Please try again.'
        } else {
          errorMessage = error.message
        }
      }

      // Show error state instead of returning to recording
      setFatalError(errorMessage)
      setIsEnding(false)
      setProcessingStep('')
      setProcessingPercent(0)
    }
  }, [duration, sessionTitle, addSession, dispatch, onComplete, showToast])

  const handleTitleClick = () => {
    setIsEditingTitle(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleTitleBlur = () => {
    setIsEditingTitle(false)
  }

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setIsEditingTitle(false)
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when editing title
      if (isEditingTitle || isEnding) return

      // Space: Pause/Resume (only when not focused on interactive elements)
      const activeTag = document.activeElement?.tagName.toLowerCase()
      const isInteractive = activeTag === 'input' || activeTag === 'button' || activeTag === 'textarea'
      if (e.code === 'Space' && !e.metaKey && !e.ctrlKey && !isInteractive) {
        e.preventDefault()
        handlePauseResume()
      }

      // Cmd+Enter: End session
      if (e.metaKey && e.key === 'Enter') {
        e.preventDefault()
        handleEndSession()
      }

      // Cmd+I: Toggle intelligence panel
      if (e.metaKey && e.key === 'i') {
        e.preventDefault()
        setShowIntelligence(prev => !prev)
      }

      // Cmd+/: Focus chat input (opens panel if closed)
      if (e.metaKey && e.key === '/') {
        e.preventDefault()
        setShowIntelligence(true)
      }

      // Escape: Close intelligence panel
      if (e.key === 'Escape' && showIntelligence) {
        setShowIntelligence(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isEditingTitle, isEnding, showIntelligence, handlePauseResume, handleEndSession])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen flex flex-col items-center justify-center bg-[var(--ink)] text-[var(--paper)]"
    >
      {/* Peripheral Glow */}
      {!isEnding && !permissionError && (
        <PeripheralGlow
          analysisMode={analysisMode}
          audioLevel={audioLevel}
          onCapture={captureFlash}
        />
      )}

      {/* Intelligence Panel Toggle */}
      {!isEnding && !permissionError && (
        <button
          onClick={() => setShowIntelligence(true)}
          className="fixed top-4 right-4 p-3 rounded-xl bg-[var(--paper)]/10 hover:bg-[var(--paper)]/20 transition-colors z-50"
          title="Toggle Intelligence Panel (⌘I)"
        >
          <Sparkles className="w-5 h-5 text-[var(--paper)]" />
        </button>
      )}

      {/* Live Session Panel */}
      <AnimatePresence>
        {showIntelligence && !isEnding && (
          <LiveSessionPanel
            sessionId={sessionIdRef.current}
            isExpanded={showIntelligence}
            onToggleExpand={() => setShowIntelligence(false)}
          />
        )}
      </AnimatePresence>

      {isEnding ? (
        /* Ending state - Elegant processing */
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          {/* Geometric animation */}
          <div className="relative w-32 h-32 mx-auto mb-10">
            {/* Orbiting rings */}
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
              className="absolute inset-0"
            >
              <div className="absolute inset-0 rounded-full border border-[var(--accent)]/30" />
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-[var(--accent)]" />
            </motion.div>

            <motion.div
              animate={{ rotate: -360 }}
              transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}
              className="absolute inset-4"
            >
              <div className="absolute inset-0 rounded-full border border-[var(--accent)]/40" />
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-[var(--accent)]" />
            </motion.div>

            {/* Center pulse */}
            <motion.div
              animate={{ scale: [0.8, 1, 0.8], opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute inset-10 rounded-full bg-[var(--accent)]"
            />
          </div>

          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-display text-2xl text-[var(--paper)] mb-3"
          >
            {processingStep || 'Processing your session'}
          </motion.h2>

          {/* Progress bar */}
          <div className="w-64 mx-auto mb-4">
            <div className="h-1.5 bg-[var(--paper)]/20 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-[var(--accent)]"
                initial={{ width: 0 }}
                animate={{ width: `${processingPercent}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
            <p className="text-xs text-[var(--paper)]/40 mt-2">{processingPercent}%</p>
          </div>

          <p className="text-[var(--paper)]/60">
            Analyzing {formatTime(duration)} of work
          </p>
        </motion.div>
      ) : permissionError ? (
        /* Permission error state */
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center max-w-md px-6"
        >
          <div className="w-16 h-16 mx-auto mb-8 rounded-2xl bg-[var(--error)]/20 flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-[var(--error)]" />
          </div>
          <h2 className="font-display text-2xl text-[var(--paper)] mb-3">
            Permission Required
          </h2>
          <p className="text-[var(--paper)]/60 mb-8">
            {permissionError}
          </p>
          <div className="flex gap-4 justify-center">
            <button
              onClick={onCancel}
              className="px-6 py-3 rounded-xl border border-[var(--paper)]/20 text-[var(--paper)]/80 hover:bg-[var(--paper)]/10 transition-colors"
            >
              Go Back
            </button>
            <button
              onClick={() => requestScreenRecordingPermission().then(() => window.location.reload())}
              className="px-6 py-3 rounded-xl bg-[var(--accent)] text-white hover:bg-[var(--accent-light)] transition-colors"
            >
              Grant Permission
            </button>
          </div>
        </motion.div>
      ) : fatalError ? (
        /* Fatal error state */
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center max-w-md px-6"
        >
          <div className="w-16 h-16 mx-auto mb-8 rounded-2xl bg-[var(--error)]/20 flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-[var(--error)]" />
          </div>
          <h2 className="font-display text-2xl text-[var(--paper)] mb-3">
            Processing Failed
          </h2>
          <p className="text-[var(--paper)]/60 mb-8">
            {fatalError}
          </p>
          <div className="flex gap-4 justify-center">
            <button
              onClick={() => {
                setFatalError(null)
                handleEndSession()
              }}
              className="px-6 py-3 rounded-xl bg-[var(--accent)] text-white hover:bg-[var(--accent)]/80 transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={() => {
                // Save session with fallback summary
                const fallbackSession: Session = {
                  id: sessionIdRef.current,
                  type: 'session',
                  title: sessionTitle || 'Untitled Session',
                  createdAt: new Date().toISOString(),
                  duration,
                  summary: {
                    text: `Session recorded for ${Math.floor(duration / 60)} minutes. AI processing failed - please try regenerating the summary.`,
                    tasks: [],
                    notes: [],
                    generatedAt: new Date().toISOString(),
                  },
                }
                addSession(fallbackSession)
                dispatch({ type: 'STOP_RECORDING' })
                onComplete(fallbackSession)
              }}
              className="px-6 py-3 rounded-xl border border-[var(--paper)]/20 text-[var(--paper)]/80 hover:bg-[var(--paper)]/10 transition-colors"
            >
              Save Without AI Summary
            </button>
          </div>
        </motion.div>
      ) : (
        /* Recording state */
        <div className="text-center">
          {/* Recording indicator */}
          <motion.div
            animate={{ opacity: isPaused ? 0.5 : [1, 0.5, 1] }}
            transition={{ duration: 2, repeat: isPaused ? 0 : Infinity }}
            className="flex items-center justify-center gap-3 mb-6"
          >
            <div className={`w-3 h-3 rounded-full ${isPaused ? 'bg-[var(--accent)]' : 'bg-[var(--session-recording)]'}`} />
            <span className="label-section !text-[var(--paper)]/60">
              {isPaused ? 'Paused' : 'Recording'}
            </span>
          </motion.div>

          {/* Capture stats */}
          {isTauri() && (
            <div className="flex items-center justify-center gap-6 mb-10 text-sm text-[var(--paper)]/50">
              {(recordingConfig?.enableScreenshots !== false) && (
                <div className="flex items-center gap-2">
                  <Camera className="w-4 h-4 text-[var(--success)]" />
                  <span>{screenshotCount} screenshots</span>
                </div>
              )}
              {recordingConfig?.enableAudio && (
                <div className="flex items-center gap-2">
                  <Mic className={`w-4 h-4 ${
                    transcriptionStatus === 'error'
                      ? 'text-[var(--error)]'
                      : transcriptionStatus === 'transcribing'
                        ? 'text-[var(--accent)] animate-pulse'
                        : transcriptionStatus === 'success'
                          ? 'text-[var(--success)]'
                          : audioLevel > 0.1
                            ? 'text-[var(--success)]'
                            : 'text-[var(--ink-muted)]'
                  }`} />
                  <span>
                    {transcriptionStatus === 'error'
                      ? 'Transcription failed'
                      : transcriptionStatus === 'transcribing'
                        ? 'Transcribing...'
                        : transcriptionStatus === 'success'
                          ? 'Transcribed'
                          : 'Audio'}
                  </span>
                  {/* Audio level indicator */}
                  {audioLevel > 0 && (
                    <div className="flex items-center gap-0.5">
                      {[0.2, 0.4, 0.6, 0.8].map((threshold) => (
                        <div
                          key={threshold}
                          className={`w-1 h-3 rounded-full transition-colors ${
                            audioLevel >= threshold ? 'bg-[var(--success)]' : 'bg-[var(--paper)]/20'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
              {recordingConfig?.enableVideo && (
                <div className="flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-[var(--success)]" />
                  <span>Video</span>
                </div>
              )}
              {!recordingConfig?.enableScreenshots && !recordingConfig?.enableAudio && !recordingConfig?.enableVideo && (
                <div className="flex items-center gap-2 text-[var(--paper)]/30">
                  <span>No capture enabled</span>
                </div>
              )}
            </div>
          )}

          {/* Session icon */}
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-[var(--session-recording)]/20 flex items-center justify-center">
              <Video className="w-6 h-6 text-[var(--session-recording)]" />
            </div>
          </div>

          {/* Title */}
          <div className="mb-4">
            {isEditingTitle ? (
              <input
                ref={inputRef}
                type="text"
                value={sessionTitle}
                onChange={(e) => setSessionTitle(e.target.value)}
                onBlur={handleTitleBlur}
                onKeyDown={handleTitleKeyDown}
                className="font-display text-2xl bg-transparent border-b border-[var(--paper)]/30 focus:border-[var(--paper)]/60 outline-none text-center w-80 text-[var(--paper)]"
              />
            ) : (
              <button
                onClick={handleTitleClick}
                className="font-display text-2xl text-[var(--paper)] hover:text-[var(--paper)]/80 transition-colors"
              >
                {sessionTitle}
              </button>
            )}
          </div>

          {/* Timer */}
          <motion.div
            key={duration}
            initial={{ scale: 1.02 }}
            animate={{ scale: 1 }}
            className="font-display text-8xl font-light tracking-tight mb-14 tabular-nums text-[var(--paper)]"
          >
            {formatTime(duration)}
          </motion.div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-6" role="group" aria-label="Recording controls">
            <motion.button
              onClick={handlePauseResume}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              aria-label={isPaused ? 'Resume recording' : 'Pause recording'}
              className="w-16 h-16 rounded-2xl bg-[var(--paper)]/10 hover:bg-[var(--paper)]/20 flex items-center justify-center transition-colors border border-[var(--paper)]/10"
            >
              {isPaused ? (
                <Play className="w-6 h-6 text-[var(--paper)] ml-1" />
              ) : (
                <Pause className="w-6 h-6 text-[var(--paper)]" />
              )}
            </motion.button>

            <motion.button
              onClick={() => setShowEndConfirm(true)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              aria-label="End recording"
              className="w-16 h-16 rounded-2xl bg-[var(--session-recording)] hover:bg-[var(--session-recording)]/80 flex items-center justify-center transition-colors shadow-lg shadow-[var(--session-recording)]/30"
            >
              <Square className="w-5 h-5 text-white" />
            </motion.button>
          </div>

          {/* Keyboard shortcuts hint */}
          <div className="flex items-center justify-center gap-4 text-xs text-[var(--paper)]/30 mt-10">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-[var(--paper)]/10">Space</kbd>
              {isPaused ? 'Resume' : 'Pause'}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-[var(--paper)]/10">⌘I</kbd>
              Intelligence
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-[var(--paper)]/10">⌘↵</kbd>
              End
            </span>
          </div>
        </div>
      )}

      {/* End Session Confirmation */}
      <ConfirmDialog
        isOpen={showEndConfirm}
        title="End Session?"
        message="Recording will stop and AI will process your session. This may take a moment."
        confirmText="End Session"
        cancelText="Keep Recording"
        confirmVariant="danger"
        onConfirm={() => {
          setShowEndConfirm(false)
          handleEndSession()
        }}
        onCancel={() => setShowEndConfirm(false)}
      />
    </motion.div>
  )
}
