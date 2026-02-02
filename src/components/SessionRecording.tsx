import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Square, Pause, Play, Camera, Mic, AlertCircle, Video, Monitor } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { ai } from '../services/ai'
import { sessionRecorder, isTauri, checkScreenRecordingPermission, requestScreenRecordingPermission, type RecordingOptions } from '../services/recording'
import { createSession, updateSessionStatus } from '../services/database'
import { sessionCoordinator } from '../services/session-coordinator'
import { generateId } from '../utils/id'
import type { Session } from '../types'
import type { RecordingConfig } from './RecordingSettings'

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
  const [isPaused, setIsPaused] = useState(false)
  const [isEnding, setIsEnding] = useState(false)
  const [duration, setDuration] = useState(0)
  const [sessionTitle, setSessionTitle] = useState('')
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [screenshotCount, setScreenshotCount] = useState(0)
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)
  const [permissionError, setPermissionError] = useState<string | null>(null)
  const startTimeRef = useRef(Date.now())
  const pausedTimeRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const sessionIdRef = useRef(generateId())

  // Get recording config from active session
  const recordingConfig: RecordingConfig | undefined = (state.activeSession as any)?.recordingConfig

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
      } : {}

      // Check if we're in Tauri
      if (isTauri()) {
        try {
          // Check permissions
          const permitted = await checkScreenRecordingPermission()
          if (!permitted) {
            const granted = await requestScreenRecordingPermission()
            if (!granted) {
              setPermissionError('Screen recording permission required')
              setHasPermission(false)
              return
            }
          }
          setHasPermission(true)

          // Start recording with config options
          await sessionRecorder.startRecording(sessionIdRef.current, recordingOptions)

          // Create database session
          await createSession('session', sessionTitle, 'ambient')

          // Start session coordinator for AI analysis
          await sessionCoordinator.startSession(sessionIdRef.current)
        } catch (e) {
          console.error('Failed to start recording:', e)
          setPermissionError(e instanceof Error ? e.message : 'Failed to start recording')
          setHasPermission(false)
        }
      } else {
        // Not in Tauri - browser only mode
        setHasPermission(true)
        console.log('Running in browser mode - no native recording')
      }
    }

    initRecording()

    // Cleanup on unmount
    return () => {
      if (sessionRecorder.isRecording()) {
        sessionRecorder.stopRecording().catch(console.error)
      }
      // Stop coordinator
      sessionCoordinator.stopSession(sessionIdRef.current).catch(console.error)
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

  const handlePauseResume = async () => {
    if (isPaused) {
      // Resume
      startTimeRef.current = Date.now() - (duration * 1000)
      try {
        await sessionRecorder.resumeRecording()
      } catch (e) {
        console.error('Failed to resume:', e)
      }
    } else {
      // Pause
      try {
        await sessionRecorder.pauseRecording()
      } catch (e) {
        console.error('Failed to pause:', e)
      }
    }
    setIsPaused(!isPaused)
  }

  const handleEndSession = async () => {
    setIsEnding(true)

    try {
      // Stop session coordinator
      await sessionCoordinator.stopSession(sessionIdRef.current)

      // Stop recording and get captured data
      let screenshots: string[] = []
      if (sessionRecorder.isRecording()) {
        const recordingState = await sessionRecorder.stopRecording()
        screenshots = recordingState.screenshots
        console.log('Captured ' + screenshots.length + ' screenshots')
      }

      // Update database session status
      await updateSessionStatus(sessionIdRef.current, 'processing', duration)

      // Process with AI
      const summary = await ai.processSession(screenshots)

      // Update database session status to complete
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
      dispatch({ type: 'STOP_RECORDING' })
      onComplete(session)
    } catch (error) {
      console.error('Failed to end session:', error)
      setIsEnding(false)
    }
  }

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

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen flex flex-col items-center justify-center bg-[var(--ink)] text-[var(--paper)]"
    >
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
            Processing your session
          </motion.h2>
          <p className="text-[var(--paper)]/60">
            Analyzing {formatTime(duration)} of work
          </p>
          <p className="text-sm text-[var(--paper)]/40 mt-4">
            AI is extracting insights and action items
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
                  <Mic className="w-4 h-4 text-[var(--success)]" />
                  <span>Audio</span>
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
          <div className="flex items-center justify-center gap-6">
            <motion.button
              onClick={handlePauseResume}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="w-16 h-16 rounded-2xl bg-[var(--paper)]/10 hover:bg-[var(--paper)]/20 flex items-center justify-center transition-colors border border-[var(--paper)]/10"
            >
              {isPaused ? (
                <Play className="w-6 h-6 text-[var(--paper)] ml-1" />
              ) : (
                <Pause className="w-6 h-6 text-[var(--paper)]" />
              )}
            </motion.button>

            <motion.button
              onClick={handleEndSession}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="w-16 h-16 rounded-2xl bg-[var(--session-recording)] hover:bg-[var(--session-recording)]/80 flex items-center justify-center transition-colors shadow-lg shadow-[var(--session-recording)]/30"
            >
              <Square className="w-5 h-5 text-white" />
            </motion.button>
          </div>

          {/* Hint */}
          <p className="text-sm text-[var(--paper)]/40 mt-10">
            Press the red button to end and generate your summary
          </p>
        </div>
      )}
    </motion.div>
  )
}
