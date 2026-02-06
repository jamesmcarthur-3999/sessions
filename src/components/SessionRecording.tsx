/**
 * SessionRecording
 *
 * Live session recording view with real-time dashboard.
 * Features:
 * - Fixed timer header with controls
 * - Scrollable dashboard with Activity, Transcript, and Insights
 * - Inline confirmation for ending session
 * - Light theme matching app design
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { SessionTimer } from './SessionTimer'
import { LiveDashboard } from './LiveDashboard'
import { sessionRecorder, isTauri, checkScreenRecordingPermission, requestScreenRecordingPermission, type RecordingOptions } from '../services/recording'
import { createSession, updateSessionStatus, updateSessionTitle, updateSessionVideoPath, saveSessionSummary, getRollingSummary, getInsights, getAudioChunks, getScreenshots } from '../services/database'
import { sessionBridge } from '../services/session-bridge'
import { smartCapture } from '../services/smart-capture'
import { aiWorker } from '../services/worker/ai-worker-client'
import { getSecureItem } from '../services/secure-storage'
import { generateId } from '../utils/id'
import { logger } from '../utils/logger'
import { useToast } from './Toast'
import type { Session, Summary, RecordingConfig } from '../types'

interface SessionRecordingProps {
  onComplete: (session: Session) => void
  onCancel: () => void
}

// Helper to check if config is the new simplified format
function isSimplifiedConfig(config: unknown): config is RecordingConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    'selectedScreens' in config &&
    Array.isArray((config as RecordingConfig).selectedScreens)
  )
}

// ============================================================================
// Recording Health Status Bar
// ============================================================================

interface RecordingHealthBarProps {
  health: {
    workerReady: boolean
    hasApiKey: boolean
    hasOpenAiKey: boolean
    screenshotsActive: boolean
    audioActive: boolean
    firstScreenshotAt: number | null
    firstErrorAt: number | null
    lastError: string | null
  }
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
    <div className={`px-4 py-2 border-b flex items-center gap-3 text-xs font-mono ${
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
  const { state, addSession, dispatch } = useApp()
  const { showToast } = useToast()
  const prefersReducedMotion = useReducedMotion()

  // Recording state
  const [isPaused, setIsPaused] = useState(false)
  const [isEnding, setIsEnding] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [processingStep, setProcessingStep] = useState('')
  const [processingPercent, setProcessingPercent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [sessionTitle, setSessionTitle] = useState('')
  const [screenshotCount, setScreenshotCount] = useState(0)
  const [permissionError, setPermissionError] = useState<string | null>(null)
  const [fatalError, setFatalError] = useState<string | null>(null)
  const [audioLevel, setAudioLevel] = useState(0)
  const [transcriptionStatus, setTranscriptionStatus] = useState<'idle' | 'transcribing' | 'success' | 'error'>('idle')
  const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null)
  const [recordingHealth, setRecordingHealth] = useState({
    workerReady: false,
    hasApiKey: false,
    hasOpenAiKey: false,
    screenshotsActive: false,
    audioActive: false,
    firstScreenshotAt: null as number | null,
    firstErrorAt: null as number | null,
    lastError: null as string | null,
  })

  // Refs
  const pausedTimeRef = useRef(0)
  const pauseStartRef = useRef(0)
  const sessionIdRef = useRef(state.activeSession?.id ?? generateId())
  const isPausedRef = useRef(false)
  const showToastRef = useRef(showToast)
  const isMountedRef = useRef(true)

  // Track mount state for async safety
  useEffect(() => {
    return () => { isMountedRef.current = false }
  }, [])

  // Keep showToast ref in sync
  useEffect(() => {
    showToastRef.current = showToast
  }, [showToast])

  // Get recording config from active session
  const recordingConfig = state.activeSession?.recordingConfig

  // Determine if audio is enabled based on config format
  const audioEnabled = recordingConfig
    ? isSimplifiedConfig(recordingConfig)
      ? recordingConfig.selectedMicrophone !== null
      : recordingConfig.enableAudio ?? false
    : false

  // Keep isPausedRef in sync
  useEffect(() => {
    isPausedRef.current = isPaused
  }, [isPaused])

  // Initialize recording on mount
  // IMPORTANT: This effect should only run ONCE on mount.
  // We track whether recording actually started to avoid cleaning up prematurely.
  useEffect(() => {
    // Track whether we successfully started the session (for cleanup decision)
    let sessionStarted = false
    let isCleaningUp = false

    async function initRecording() {
      // Generate default title
      const now = new Date()
      const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      const defaultTitle = `Session at ${timeStr}`
      setSessionTitle(defaultTitle)

      // Build recording options from config
      const config = recordingConfig
      let recordingOptions: Partial<RecordingOptions> = {}

      if (config) {
        if (isSimplifiedConfig(config)) {
          // New simplified config - map to full options
          recordingOptions = {
            enableScreenshots: true, // Always enabled
            enableAudio: config.selectedMicrophone !== null,
            enableVideo: true, // Always enabled
            screenshotIntervalMs: 30000, // Smart capture handles timing
            selectedMicrophone: config.selectedMicrophone,
            selectedScreen: config.selectedScreens[0] ?? null, // Use first screen
            smartCaptureEnabled: true, // Always smart
          }
        } else {
          // Legacy config format
          recordingOptions = {
            enableScreenshots: config.enableScreenshots,
            enableAudio: config.enableAudio,
            enableVideo: config.enableVideo,
            screenshotIntervalMs: config.screenshotInterval * 60 * 1000,
            selectedMicrophone: config.selectedMicrophone,
            selectedScreen: config.selectedScreen,
            smartCaptureEnabled: config.smartCaptureEnabled,
          }
        }
      }

      // Always use deep analysis mode
      const analysisMode: 'ambient' | 'deep' = 'deep'

      if (isTauri()) {
        try {
          // Check for early cleanup
          if (isCleaningUp) return

          // Verify permission
          const permitted = await checkScreenRecordingPermission()
          if (isCleaningUp) return

          if (!permitted) {
            setPermissionError('Screen recording permission was revoked. Please grant permission again.')
            return
          }

          // Pre-flight checks: warn about missing API keys (non-fatal)
          const anthropicKey = await getSecureItem('sessions_api_key')
          const openaiKey = await getSecureItem('sessions_openai_api_key')
          if (isCleaningUp) return

          if (!anthropicKey) {
            showToastRef.current('No Claude API key configured. Session will record but AI insights won\'t generate. Add key in Settings.', 'error', 10000)
          }
          if (!openaiKey && recordingOptions.enableAudio) {
            showToastRef.current('No OpenAI API key configured. Audio won\'t be transcribed. Add key in Settings.', 'error', 10000)
          }

          setRecordingHealth(prev => ({
            ...prev,
            hasApiKey: !!anthropicKey,
            hasOpenAiKey: !!openaiKey,
          }))

          // Create database session
          await createSession(sessionIdRef.current, 'session', defaultTitle, analysisMode)
          if (isCleaningUp) return

          // Start session coordinator for AI analysis
          await sessionBridge.startSession(sessionIdRef.current)
          if (isCleaningUp) return

          // Check worker readiness after bridge init
          const workerReady = aiWorker.isReady()
          setRecordingHealth(prev => ({ ...prev, workerReady }))
          if (!workerReady) {
            showToastRef.current('AI worker failed to initialize. Insights and summaries won\'t generate this session.', 'error', 10000)
          }

          // Start recording - this is the point of no return
          const result = await sessionRecorder.startRecording(sessionIdRef.current, recordingOptions)

          // Mark session as successfully started
          sessionStarted = true
          setRecordingStartTime(Date.now())

          // Update health based on what actually started
          setRecordingHealth(prev => ({
            ...prev,
            screenshotsActive: !result.errors.some(e => e.toLowerCase().includes('screenshot')),
            audioActive: recordingOptions.enableAudio ? !result.errors.some(e => e.toLowerCase().includes('audio')) : false,
          }))

          if (isCleaningUp) {
            // Cleanup was triggered while we were starting - clean up now
            logger.debug('[SessionRecording] Cleanup triggered during init, stopping')
            await sessionRecorder.stopRecording().catch(() => {})
            await sessionBridge.stopSession(sessionIdRef.current).catch(() => {})
            return
          }

          // Show warnings for partial failures (use ref to avoid dep)
          for (const error of result.errors) {
            showToastRef.current(error, 'error', 5000)
          }

          logger.info('[SessionRecording] Recording started successfully')
        } catch (e) {
          // Don't show errors if we're cleaning up
          if (isCleaningUp) return

          logger.error('Failed to start recording:', e)
          const errorMessage = e instanceof Error ? e.message : 'Failed to start recording'

          // Try to clean up the partial state
          try {
            await updateSessionStatus(sessionIdRef.current, 'error')
          } catch {
            // Ignore
          }
          try {
            await sessionBridge.stopSession(sessionIdRef.current)
          } catch {
            // Ignore
          }
          try {
            if (sessionRecorder.isRecording()) {
              await sessionRecorder.stopRecording()
            }
          } catch {
            // Ignore
          }

          // Set error state - this will show the error UI
          setFatalError(errorMessage)
        }
      }
    }

    initRecording()

    // Protect against window close during recording
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (sessionStarted || sessionRecorder.isRecording()) {
        e.preventDefault()
        e.returnValue = 'Recording in progress. Are you sure you want to leave?'
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    // Tauri-specific window close handler
    let unlistenClose: (() => void) | undefined
    if (isTauri()) {
      import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
        const appWindow = getCurrentWindow()
        appWindow.onCloseRequested(async (event) => {
          if (sessionStarted || sessionRecorder.isRecording()) {
            event.preventDefault()
            setShowConfirmation(true)
          }
        }).then(fn => { unlistenClose = fn })
      }).catch((err: unknown) => logger.error(err))
    }

    // Cleanup function
    return () => {
      isCleaningUp = true
      window.removeEventListener('beforeunload', handleBeforeUnload)
      unlistenClose?.()

      // Only clean up if the session was actually started
      // This prevents React StrictMode's double-mount from stopping the session prematurely
      if (sessionStarted || sessionRecorder.isRecording()) {
        const sessionId = sessionIdRef.current
        logger.debug('[SessionRecording] Cleanup: stopping session', sessionId)

        // Fire-and-forget cleanup (we can't await in cleanup)
        Promise.all([
          sessionRecorder.isRecording()
            ? sessionRecorder.stopRecording().catch(() => {})
            : Promise.resolve(),
          sessionBridge.stopSession(sessionId).catch(() => {}),
        ]).catch(() => {
          // Ignore all cleanup errors
        })
      } else {
        logger.debug('[SessionRecording] Cleanup: session not started, skipping')
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally run once on mount
  }, [])

  // Timer — only starts counting once recording is confirmed active
  useEffect(() => {
    if (!recordingStartTime || isPaused || isEnding) return

    const interval = setInterval(() => {
      if (!isMountedRef.current) return
      const elapsed = Math.floor((Date.now() - recordingStartTime - pausedTimeRef.current) / 1000)
      setDuration(elapsed)

      const recState = sessionRecorder.getState()
      if (recState) {
        setScreenshotCount(recState.screenshotCount)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [recordingStartTime, isPaused, isEnding])

  // Listen for capture events
  useEffect(() => {
    const unsubCapture = smartCapture.on('capture', () => {
      setRecordingHealth(prev => ({
        ...prev,
        screenshotsActive: true,
        firstScreenshotAt: prev.firstScreenshotAt ?? Date.now(),
      }))
    })
    const unsubCaptureError = smartCapture.on('capture-error', ({ error }) => {
      showToastRef.current(`Screenshot: ${error}`, 'error', 5000)
      setRecordingHealth(prev => ({
        ...prev,
        lastError: error,
        firstErrorAt: prev.firstErrorAt ?? Date.now(),
      }))
    })
    return () => {
      unsubCapture()
      unsubCaptureError()
    }
  }, [])

  // Audio level events
  useEffect(() => {
    if (!isTauri() || !audioEnabled) {
      setAudioLevel(0)
      return
    }

    let cancelled = false
    let unlisten: (() => void) | null = null

    const setupListener = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event')
        if (cancelled) return

        unlisten = await listen<{ level: number }>('audio-level', (event) => {
          if (!isPausedRef.current && !cancelled) {
            setAudioLevel(event.payload.level)
          }
        })
      } catch (error) {
        logger.error('Failed to setup audio level listener:', error)
      }
    }

    setupListener()

    return () => {
      cancelled = true
      unlisten?.()
      setAudioLevel(0)
    }
  }, [audioEnabled])

  // Coordinator events
  useEffect(() => {
    let statusResetTimer: ReturnType<typeof setTimeout> | null = null

    const unsubError = sessionBridge.on('error', ({ error }) => {
      showToast(error, 'error', 5000)
      setRecordingHealth(prev => ({
        ...prev,
        lastError: error,
        firstErrorAt: prev.firstErrorAt ?? Date.now(),
      }))
      if (error.includes('transcription')) {
        setTranscriptionStatus('error')
      }
    })

    const unsubTranscriptionStart = sessionBridge.on('transcription-start', () => {
      setTranscriptionStatus('transcribing')
    })

    const unsubTranscriptionComplete = sessionBridge.on('transcription-complete', () => {
      setTranscriptionStatus('success')
      statusResetTimer = setTimeout(() => {
        if (isMountedRef.current) setTranscriptionStatus('idle')
      }, 2000)
    })

    return () => {
      unsubError()
      unsubTranscriptionStart()
      unsubTranscriptionComplete()
      if (statusResetTimer) clearTimeout(statusResetTimer)
    }
  }, [showToast])

  // Pause/resume handler
  const handlePauseResume = useCallback(async () => {
    if (isPaused) {
      pausedTimeRef.current += Date.now() - pauseStartRef.current
      try {
        await sessionRecorder.resumeRecording()
        sessionBridge.resumeSession(sessionIdRef.current)
      } catch (e) {
        logger.error('Failed to resume:', e)
      }
    } else {
      pauseStartRef.current = Date.now()
      try {
        await sessionRecorder.pauseRecording()
        sessionBridge.pauseSession(sessionIdRef.current)
      } catch (e) {
        logger.error('Failed to pause:', e)
      }
    }
    setIsPaused(prev => !prev)
  }, [isPaused])

  // Title change handler
  const handleTitleChange = useCallback((newTitle: string) => {
    setSessionTitle(newTitle)
    if (isTauri()) {
      updateSessionTitle(sessionIdRef.current, newTitle).catch((err: unknown) => logger.error(err))
    }
  }, [])

  // End session handler
  const handleEndSession = useCallback(async () => {
    setIsEnding(true)
    setShowConfirmation(false)
    setProcessingStep('Stopping recording...')
    setProcessingPercent(10)

    const inTauri = isTauri()

    try {
      if (inTauri) {
        setProcessingStep('Stopping AI analysis...')
        setProcessingPercent(20)
        await sessionBridge.stopSession(sessionIdRef.current)
      }

      setProcessingStep('Finalizing captures...')
      setProcessingPercent(30)

      let videoPath: string | undefined
      let stopWarnings: string[] = []

      if (sessionRecorder.isRecording()) {
        const recordingState = await sessionRecorder.stopRecording()
        videoPath = recordingState.videoPath
        stopWarnings = recordingState.stopErrors || []

        for (const warning of stopWarnings) {
          showToast(warning, 'error', 5000)
        }
      }

      let rollingSummary = null
      let insights: Awaited<ReturnType<typeof getInsights>> = []
      let audioChunks: Awaited<ReturnType<typeof getAudioChunks>> = []
      let dbScreenshots: Awaited<ReturnType<typeof getScreenshots>> = []

      if (inTauri) {
        setProcessingStep('Gathering session data...')
        setProcessingPercent(40)
        await updateSessionStatus(sessionIdRef.current, 'processing', duration)

        if (videoPath) {
          try {
            await updateSessionVideoPath(sessionIdRef.current, videoPath)
          } catch {
            logger.error('[DATABASE] Failed to save video path')
          }
        }

        setProcessingPercent(50)
        ;[rollingSummary, insights, audioChunks, dbScreenshots] = await Promise.all([
          getRollingSummary(sessionIdRef.current),
          getInsights(sessionIdRef.current),
          getAudioChunks(sessionIdRef.current),
          getScreenshots(sessionIdRef.current),
        ])
      }

      setProcessingStep('Generating AI summary...')
      setProcessingPercent(60)

      let summary: Summary

      const hasContent =
        rollingSummary?.content ||
        (insights && insights.length > 0) ||
        (audioChunks && audioChunks.some(c => c.transcript)) ||
        (dbScreenshots && dbScreenshots.some(s => s.analysis))
      logger.info('[SessionRecording] hasContent:', !!hasContent, 'duration:', duration, 'rollingSummary:', !!rollingSummary?.content, 'insights:', insights?.length, 'audioChunks with transcript:', audioChunks?.filter(c => c.transcript).length, 'screenshots with analysis:', dbScreenshots?.filter(s => s.analysis).length)

      if (hasContent || duration >= 60) {
        // Generate final summary through the worker (off main thread)
        logger.info('[SessionRecording] Generating AI final summary via worker...')
        setProcessingPercent(70)

        const result = await aiWorker.generateFinalSummary({
          rollingSummary,
          insights: insights || [],
          audioChunks: audioChunks || [],
          screenshots: dbScreenshots || [],
          durationSeconds: duration,
          title: sessionTitle || 'Untitled Session',
        })
        logger.info('[SessionRecording] Final summary result:', result.text ? 'success' : 'null', result.error || '')

        if (result.error) {
          // Worker couldn't generate — build fallback
          logger.warn('[SessionRecording] Worker error, using fallback:', result.error)
          const transcriptText = audioChunks
            ?.filter(c => c.transcript)
            ?.map(c => c.transcript)
            ?.join(' ') || ''

          const summaryText = rollingSummary?.content
            || (transcriptText
              ? `Session transcript: ${transcriptText.slice(0, 1000)}...`
              : `Session recorded for ${Math.floor(duration / 60)} minutes.`)

          summary = {
            text: summaryText + '\n\nConfigure your Claude API key in Settings to enable AI-powered summaries.',
            tasks: [],
            notes: (insights || []).slice(0, 10).map(i => ({
              id: generateId(),
              content: i.content,
            })),
            generatedAt: new Date().toISOString(),
          }
        } else {
          summary = {
            text: result.text ?? 'Session completed.',
            tasks: (result.tasks ?? []).map((t: string) => ({
              id: generateId(),
              title: t,
              completed: false,
            })),
            notes: (result.notes ?? []).map((n: string) => ({
              id: generateId(),
              content: n,
            })),
            generatedAt: new Date().toISOString(),
          }
        }
      } else {
        // Not enough content even for AI
        summary = {
          text: `Session recorded for ${Math.floor(duration / 60)} minutes.`,
          tasks: [],
          notes: (insights || []).slice(0, 10).map(i => ({
            id: generateId(),
            content: i.content,
          })),
          generatedAt: new Date().toISOString(),
        }
      }

      if (inTauri) {
        try {
          await saveSessionSummary(sessionIdRef.current, summary)
        } catch {
          logger.error('[DATABASE] Failed to save session summary')
        }
      }

      setProcessingStep('Saving session...')
      setProcessingPercent(90)

      if (inTauri) {
        await updateSessionStatus(sessionIdRef.current, 'complete', duration)
      }

      const session: Session = {
        id: sessionIdRef.current,
        type: 'session',
        title: sessionTitle || 'Untitled Session',
        createdAt: new Date().toISOString(),
        duration,
        videoPath,
        summary,
        status: 'complete',
      }

      await addSession(session)

      setProcessingStep('Complete!')
      setProcessingPercent(100)

      dispatch({ type: 'STOP_RECORDING' })
      onComplete(session)
    } catch (error) {
      logger.error('Failed to end session:', error)

      if (inTauri) {
        try {
          await updateSessionStatus(sessionIdRef.current, 'error', duration)
        } catch {
          // Ignore
        }
      }

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

      setFatalError(errorMessage)
      setIsEnding(false)
      setProcessingStep('')
      setProcessingPercent(0)
    }
  }, [duration, sessionTitle, addSession, dispatch, onComplete, showToast])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEnding) return

      const activeTag = document.activeElement?.tagName.toLowerCase()
      const isInteractive = activeTag === 'input' || activeTag === 'button' || activeTag === 'textarea'

      // Space: Pause/Resume
      if (e.code === 'Space' && !e.metaKey && !e.ctrlKey && !isInteractive) {
        e.preventDefault()
        handlePauseResume()
      }

      // Cmd+Enter: End session
      if (e.metaKey && e.key === 'Enter') {
        e.preventDefault()
        if (showConfirmation) {
          handleEndSession()
        } else {
          setShowConfirmation(true)
        }
      }

      // Escape: Cancel confirmation
      if (e.key === 'Escape' && showConfirmation) {
        setShowConfirmation(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isEnding, showConfirmation, handlePauseResume, handleEndSession])

  // Auto-dismiss confirmation after 5 seconds
  useEffect(() => {
    if (!showConfirmation) return

    const timeout = setTimeout(() => {
      setShowConfirmation(false)
    }, 5000)

    return () => clearTimeout(timeout)
  }, [showConfirmation])

  // No-activity warning: if no screenshots captured within 20s of recording start
  useEffect(() => {
    if (!recordingStartTime) return
    const timeout = setTimeout(() => {
      if (screenshotCount === 0 && isMountedRef.current) {
        showToastRef.current(
          'No screenshots captured after 20s. Check Screen Recording permission in System Settings > Privacy & Security.',
          'error',
          15000
        )
      }
    }, 20000)
    return () => clearTimeout(timeout)
  }, [recordingStartTime, screenshotCount])

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

  // Fatal error state - handles both initialization and processing failures
  if (fatalError) {
    // Check if recording actually started (determines what cleanup is needed)
    const recordingStarted = sessionRecorder.isRecording() || duration > 0

    const handleGoBack = async () => {
      // Clean up any partial state
      try {
        if (sessionRecorder.isRecording()) {
          await sessionRecorder.stopRecording()
        }
      } catch {
        // Ignore
      }
      try {
        await sessionBridge.stopSession(sessionIdRef.current)
      } catch {
        // Ignore
      }
      dispatch({ type: 'STOP_RECORDING' })
      onCancel()
    }

    const handleRetry = () => {
      // Reset state and reinitialize via reload
      setFatalError(null)
      window.location.reload()
    }

    const handleSavePartial = async () => {
      // Try to save whatever we have
      try {
        if (sessionRecorder.isRecording()) {
          await sessionRecorder.stopRecording()
        }
      } catch {
        // Ignore
      }
      try {
        await sessionBridge.stopSession(sessionIdRef.current)
      } catch {
        // Ignore
      }

      const fallbackSession: Session = {
        id: sessionIdRef.current,
        type: 'session',
        title: sessionTitle || 'Untitled Session',
        createdAt: new Date().toISOString(),
        duration,
        summary: {
          text: duration > 0
            ? `Session recorded for ${Math.floor(duration / 60)} minutes. AI processing failed: ${fatalError}`
            : `Session could not be started: ${fatalError}`,
          tasks: [],
          notes: [],
          generatedAt: new Date().toISOString(),
        },
        status: 'complete',
      }
      addSession(fallbackSession)
      dispatch({ type: 'STOP_RECORDING' })
      onComplete(fallbackSession)
    }

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

      {/* Recording health status bar — auto-hides after 30s if all healthy */}
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
            sessionId={sessionIdRef.current}
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
