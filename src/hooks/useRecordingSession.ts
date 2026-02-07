/**
 * useRecordingSession
 *
 * Manages the full recording session lifecycle:
 * - Initialization (permissions, database, recorder start)
 * - Pause/resume, title changes
 * - Health monitoring (smart capture events, audio level, coordinator events)
 * - Keyboard shortcuts (Space = pause, Cmd+Enter = end)
 * - End session (stop recording, generate summary, save)
 * - Window close protection
 * - Error recovery
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useApp } from '../context/AppContext'
import { sessionRecorder, isTauri, checkScreenRecordingPermission, type RecordingOptions } from '../services/recording'
import { createSession, updateSessionStatus, updateSessionTitle, updateSessionVideoPath, saveSessionSummary, getRollingSummary, getInsights, getAudioChunks, getScreenshots } from '../services/database'
import { sessionBridge } from '../services/session-bridge'
import { smartCapture } from '../services/smart-capture'
import { aiWorker } from '../services/worker/ai-worker-client'
import { getSecureItem } from '../services/secure-storage'
import { generateId } from '../utils/id'
import { logger } from '../utils/logger'
import type { Session, Summary } from '../types'

export interface RecordingHealthState {
  workerReady: boolean
  hasApiKey: boolean
  hasOpenAiKey: boolean
  screenshotsActive: boolean
  audioActive: boolean
  firstScreenshotAt: number | null
  firstErrorAt: number | null
  lastError: string | null
}

export interface UseRecordingSessionReturn {
  // State
  isPaused: boolean
  isEnding: boolean
  showConfirmation: boolean
  processingStep: string
  processingPercent: number
  duration: number
  sessionTitle: string
  screenshotCount: number
  permissionError: string | null
  fatalError: string | null
  recordingStartTime: number | null
  recordingHealth: RecordingHealthState
  audioEnabled: boolean
  audioLevel: number
  transcriptionStatus: 'idle' | 'transcribing' | 'success' | 'error'
  sessionId: string
  recordingStarted: boolean

  // Actions
  handlePauseResume: () => Promise<void>
  handleEndSession: () => Promise<void>
  handleTitleChange: (title: string) => void
  setShowConfirmation: (show: boolean) => void
  setFatalError: (error: string | null) => void

  // Error recovery
  handleGoBack: () => Promise<void>
  handleRetry: () => void
  handleSavePartial: () => Promise<void>
}

export function useRecordingSession(
  onComplete: (session: Session) => void,
  onCancel: () => void,
  showToast: (message: string, type: 'success' | 'error' | 'info', duration?: number) => void,
): UseRecordingSessionReturn {
  const { state, addSession, dispatch } = useApp()

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
  const [recordingHealth, setRecordingHealth] = useState<RecordingHealthState>({
    workerReady: false,
    hasApiKey: false,
    hasOpenAiKey: false,
    screenshotsActive: false,
    audioActive: false,
    firstScreenshotAt: null,
    firstErrorAt: null,
    lastError: null,
  })

  // Refs
  const pausedTimeRef = useRef(0)
  const pauseStartRef = useRef(0)
  const sessionIdRef = useRef(state.activeSession?.id ?? generateId())
  const isPausedRef = useRef(false)
  const showToastRef = useRef(showToast)
  const isMountedRef = useRef(true)
  const userSetTitleRef = useRef(false)

  // Get recording config from active session
  const recordingConfig = state.activeSession?.recordingConfig
  const audioEnabled = recordingConfig
    ? recordingConfig.selectedMicrophone !== null
    : false

  // Track mount state for async safety
  useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

  // Keep refs in sync
  useEffect(() => { showToastRef.current = showToast }, [showToast])
  useEffect(() => { isPausedRef.current = isPaused }, [isPaused])

  // ========================================================================
  // Initialize recording on mount
  // ========================================================================
  useEffect(() => {
    let sessionStarted = false
    let isCleaningUp = false

    async function initRecording() {
      const now = new Date()
      const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      const defaultTitle = `Session at ${timeStr}`
      setSessionTitle(defaultTitle)

      const config = recordingConfig
      let recordingOptions: Partial<RecordingOptions> = {}

      if (config) {
        recordingOptions = {
          enableScreenshots: true,
          enableAudio: config.selectedMicrophone !== null,
          enableVideo: true,
          screenshotIntervalMs: 30000,
          selectedMicrophone: config.selectedMicrophone,
          selectedScreen: config.selectedScreens[0] ?? null,
          smartCaptureEnabled: true,
        }
      }

      const analysisMode: 'ambient' | 'deep' = 'deep'

      if (isTauri()) {
        try {
          if (isCleaningUp) return

          const permitted = await checkScreenRecordingPermission()
          if (isCleaningUp) return

          if (!permitted) {
            setPermissionError('Screen recording permission was revoked. Please grant permission again.')
            return
          }

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

          await createSession(sessionIdRef.current, 'session', defaultTitle, analysisMode)
          if (isCleaningUp) return

          await sessionBridge.startSession(sessionIdRef.current)
          if (isCleaningUp) return

          const workerReady = aiWorker.isReady()
          setRecordingHealth(prev => ({ ...prev, workerReady }))
          if (!workerReady) {
            showToastRef.current('AI worker failed to initialize. Insights and summaries won\'t generate this session.', 'error', 10000)
          }

          const result = await sessionRecorder.startRecording(sessionIdRef.current, recordingOptions)

          sessionStarted = true
          setRecordingStartTime(Date.now())

          setRecordingHealth(prev => ({
            ...prev,
            screenshotsActive: !result.errors.some(e => e.toLowerCase().includes('screenshot')),
            audioActive: recordingOptions.enableAudio ? !result.errors.some(e => e.toLowerCase().includes('audio')) : false,
          }))

          if (isCleaningUp) {
            logger.debug('[SessionRecording] Cleanup triggered during init, stopping')
            await sessionRecorder.stopRecording().catch(() => {})
            await sessionBridge.stopSession(sessionIdRef.current).catch(() => {})
            return
          }

          for (const error of result.errors) {
            showToastRef.current(error, 'error', 5000)
          }

          logger.info('[SessionRecording] Recording started successfully')
        } catch (e) {
          if (isCleaningUp) return

          logger.error('Failed to start recording:', e)
          const errorMessage = e instanceof Error ? e.message : 'Failed to start recording'

          try { await updateSessionStatus(sessionIdRef.current, 'error') } catch { /* Ignore */ }
          try { await sessionBridge.stopSession(sessionIdRef.current) } catch { /* Ignore */ }
          try { if (sessionRecorder.isRecording()) await sessionRecorder.stopRecording() } catch { /* Ignore */ }

          setFatalError(errorMessage)
        }
      }
    }

    initRecording()

    // Window close protection
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (sessionStarted || sessionRecorder.isRecording()) {
        e.preventDefault()
        e.returnValue = 'Recording in progress. Are you sure you want to leave?'
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

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

    return () => {
      isCleaningUp = true
      window.removeEventListener('beforeunload', handleBeforeUnload)
      unlistenClose?.()

      if (sessionStarted || sessionRecorder.isRecording()) {
        const sessionId = sessionIdRef.current
        logger.debug('[SessionRecording] Cleanup: stopping session', sessionId)
        Promise.all([
          sessionRecorder.isRecording()
            ? sessionRecorder.stopRecording().catch(e => { logger.error('[Cleanup] stopRecording failed:', e) })
            : Promise.resolve(),
          sessionBridge.stopSession(sessionId).catch(e => { logger.error('[Cleanup] stopSession failed:', e) }),
        ]).catch(e => { logger.error('[Cleanup] Unexpected cleanup error:', e) })
      } else {
        logger.debug('[SessionRecording] Cleanup: session not started, skipping')
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally run once on mount
  }, [])

  // ========================================================================
  // Timer
  // ========================================================================
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

  // ========================================================================
  // Smart capture events
  // ========================================================================
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

  // ========================================================================
  // Audio level events
  // ========================================================================
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

  // ========================================================================
  // Session bridge (coordinator) events
  // ========================================================================
  useEffect(() => {
    const unsubError = sessionBridge.on('error', ({ error }) => {
      showToastRef.current(error, 'error', 5000)
      setRecordingHealth(prev => ({
        ...prev,
        lastError: error,
        firstErrorAt: prev.firstErrorAt ?? Date.now(),
      }))
      if (error.includes('transcription')) {
        setTranscriptionStatus('error')
      }
    })

    const unsubRecordingError = sessionBridge.on('recording-error', ({ error }) => {
      showToastRef.current(error, 'error', 5000)
      setRecordingHealth(prev => ({
        ...prev,
        lastError: error,
        firstErrorAt: prev.firstErrorAt ?? Date.now(),
      }))
    })

    return () => {
      unsubError()
      unsubRecordingError()
    }
  }, [])

  // ========================================================================
  // Session Narrator — auto-title from speech
  // ========================================================================
  useEffect(() => {
    const unsub = sessionBridge.on('title-suggestion', (data) => {
      if (data.sessionId !== sessionIdRef.current) return
      if (userSetTitleRef.current) return // Respect user's title
      setSessionTitle(data.title)
      if (isTauri()) {
        updateSessionTitle(sessionIdRef.current, data.title).catch((err: unknown) => logger.error(err))
      }
    })
    return unsub
  }, [])

  // ========================================================================
  // No-activity warning
  // ========================================================================
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

  // ========================================================================
  // Auto-dismiss confirmation after 5 seconds
  // ========================================================================
  useEffect(() => {
    if (!showConfirmation) return
    const timeout = setTimeout(() => setShowConfirmation(false), 5000)
    return () => clearTimeout(timeout)
  }, [showConfirmation])

  // ========================================================================
  // Pause/resume
  // ========================================================================
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

  // ========================================================================
  // Title change
  // ========================================================================
  const handleTitleChange = useCallback((newTitle: string) => {
    userSetTitleRef.current = true
    setSessionTitle(newTitle)
    if (isTauri()) {
      updateSessionTitle(sessionIdRef.current, newTitle).catch((err: unknown) => logger.error(err))
    }
  }, [])

  // ========================================================================
  // End session
  // ========================================================================
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

      if (hasContent || duration >= 60) {
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

        if (result.error) {
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
        try { await saveSessionSummary(sessionIdRef.current, summary) } catch { logger.error('[DATABASE] Failed to save session summary') }
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
        try { await updateSessionStatus(sessionIdRef.current, 'error', duration) } catch { /* Ignore */ }
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

  // ========================================================================
  // Keyboard shortcuts
  // ========================================================================
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

  // ========================================================================
  // Error recovery handlers
  // ========================================================================
  const handleGoBack = useCallback(async () => {
    try { if (sessionRecorder.isRecording()) await sessionRecorder.stopRecording() } catch { /* Ignore */ }
    try { await sessionBridge.stopSession(sessionIdRef.current) } catch { /* Ignore */ }
    dispatch({ type: 'STOP_RECORDING' })
    onCancel()
  }, [dispatch, onCancel])

  const handleRetry = useCallback(() => {
    setFatalError(null)
    window.location.reload()
  }, [])

  const handleSavePartial = useCallback(async () => {
    try { if (sessionRecorder.isRecording()) await sessionRecorder.stopRecording() } catch { /* Ignore */ }
    try { await sessionBridge.stopSession(sessionIdRef.current) } catch { /* Ignore */ }

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
  }, [sessionTitle, duration, fatalError, addSession, dispatch, onComplete])

  const recordingStarted = sessionRecorder.isRecording() || duration > 0

  return {
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
    sessionId: sessionIdRef.current,
    recordingStarted,
    handlePauseResume,
    handleEndSession,
    handleTitleChange,
    setShowConfirmation,
    setFatalError,
    handleGoBack,
    handleRetry,
    handleSavePartial,
  }
}
