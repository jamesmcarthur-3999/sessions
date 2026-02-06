/**
 * Recording Service
 *
 * Handles session recording via Tauri backend:
 * - Screenshot capture at intervals
 * - Audio recording
 * - Video recording (macOS)
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { saveAudioChunk } from './database'
import { aiWorker } from './worker'
import { smartCapture } from './smart-capture'
import { loadAudioBinary } from './audio-storage'
import { captureAnalyzeScreenshot } from './capture-screenshot'
import type { RecordingStopResult } from '../types'
import { logger } from '../utils/logger'

// Ensure Tauri environment is available
function ensureTauri(): void {
  if (typeof window === 'undefined' || !('__TAURI__' in window || '__TAURI_INTERNALS__' in window)) {
    throw new Error('Not running in Tauri environment')
  }
}

// Type-safe invoke wrapper
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  ensureTauri()
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke<T>(cmd, args)
}

// Type-safe invoke wrapper with timeout to prevent indefinite hangs
async function invokeWithTimeout<T>(
  cmd: string,
  args?: Record<string, unknown>,
  timeoutMs: number = 10000
): Promise<T> {
  ensureTauri()
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')

  return Promise.race([
    tauriInvoke<T>(cmd, args),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`IPC timeout after ${timeoutMs}ms: ${cmd}`)),
        timeoutMs
      )
    )
  ])
}

// Check if running in Tauri
// In Tauri v2, __TAURI__ is injected but may not be available immediately
// Also check for __TAURI_INTERNALS__ which is always present
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI__' in window || '__TAURI_INTERNALS__' in window;
}

// ============================================================================
// Screenshot Capture
// ============================================================================

/**
 * Capture screenshot and write directly to file from Rust.
 * Returns the file path — no base64 IPC round-trip.
 */
export async function captureScreenshotToFile(
  sessionId: string,
  screenshotId: string,
  screenId?: string | null,
  maxWidth?: number,
  quality?: number
): Promise<string> {
  return invoke<string>('capture_screenshot_to_file', {
    sessionId,
    screenshotId,
    screenId: screenId ?? null,
    maxWidth: maxWidth ?? null,
    quality: quality ?? null,
  })
}

export async function testCaptureScreenshot(screenId?: string | null): Promise<string> {
  return invoke<string>('test_capture_screenshot', { screenId: screenId ?? null })
}

// ============================================================================
// Device Enumeration
// ============================================================================

export interface AudioDevice {
  id: string
  name: string
  isDefault: boolean
}

export interface ScreenInfo {
  id: string
  name: string
  width: number
  height: number
  x: number
  y: number
  isPrimary: boolean
}

export async function getAudioDevices(): Promise<AudioDevice[]> {
  return invoke<AudioDevice[]>('get_audio_devices')
}

export async function getScreens(): Promise<ScreenInfo[]> {
  return invoke<ScreenInfo[]>('get_screens')
}

// ============================================================================
// Permissions
// ============================================================================

export async function checkScreenRecordingPermission(): Promise<boolean> {
  return invoke<boolean>('check_screen_recording_permission')
}

export async function requestScreenRecordingPermission(): Promise<boolean> {
  return invoke<boolean>('request_screen_recording_permission')
}

// ============================================================================
// Audio Recording
// ============================================================================

export async function startAudioRecording(
  sessionId: string,
  chunkDurationSecs?: number,
  deviceId?: string | null
): Promise<void> {
  return invokeWithTimeout('start_audio_recording', {
    sessionId,
    chunkDurationSecs: chunkDurationSecs ?? 120,
    deviceId: deviceId ?? null,
  }, 5000)
}

export async function pauseAudioRecording(): Promise<void> {
  return invoke('pause_audio_recording')
}

export async function resumeAudioRecording(): Promise<void> {
  return invoke('resume_audio_recording')
}

export async function stopAudioRecording(): Promise<void> {
  return invokeWithTimeout('stop_audio_recording', undefined, 5000)
}

// ============================================================================
// Video Recording
// ============================================================================

export interface VideoQuality {
  width: number
  height: number
  fps: number
}

export async function startVideoRecording(
  sessionId: string,
  outputPath: string,
  quality?: VideoQuality
): Promise<void> {
  return invokeWithTimeout('start_video_recording', {
    sessionId,
    outputPath,
    quality,
  }, 5000)
}

export async function stopVideoRecording(): Promise<string> {
  return invokeWithTimeout<string>('stop_video_recording', undefined, 5000)
}

export async function isVideoRecording(): Promise<boolean> {
  return invoke<boolean>('is_recording')
}

// ============================================================================
// Session Recording Controller
// ============================================================================

export interface RecordingOptions {
  enableScreenshots: boolean
  enableAudio: boolean
  enableVideo: boolean
  screenshotIntervalMs: number
  selectedMicrophone: string | null
  selectedScreen: string | null
  smartCaptureEnabled: boolean
}

export interface SessionRecordingState {
  sessionId: string
  isRecording: boolean
  isPaused: boolean
  /** Count of screenshots captured (data stored on disk, not in memory) */
  screenshotCount: number
  /** Count of audio chunks captured (data stored on disk, not in memory) */
  audioChunkCount: number
  videoPath?: string
  startTime: number
  options: RecordingOptions
}

export interface RecordingStartResult {
  success: boolean
  screenshotsEnabled: boolean
  audioEnabled: boolean
  videoEnabled: boolean
  errors: string[]
}

const defaultOptions: RecordingOptions = {
  enableScreenshots: true,
  enableAudio: false,
  enableVideo: false,
  screenshotIntervalMs: 30000,
  selectedMicrophone: null,
  selectedScreen: null,
  smartCaptureEnabled: true,
}

class SessionRecordingController {
  private state: SessionRecordingState | null = null
  private screenshotInterval: ReturnType<typeof setInterval> | null = null
  private audioChunkListener: UnlistenFn | null = null
  private audioPcmListener: UnlistenFn | null = null
  private liveTranscriptionActive = false

  async startRecording(sessionId: string, options: Partial<RecordingOptions> = {}): Promise<RecordingStartResult> {
    if (this.state?.isRecording) {
      throw new Error('Already recording')
    }

    const mergedOptions = { ...defaultOptions, ...options }
    const errors: string[] = []
    let audioStarted = false
    let screenshotsStarted = false
    let videoStarted = false

    // Initialize state
    this.state = {
      sessionId,
      isRecording: true,
      isPaused: false,
      screenshotCount: 0,
      audioChunkCount: 0,
      startTime: Date.now(),
      options: mergedOptions,
    }

    // Permission should be granted before calling startRecording
    // Just verify it's still valid
    if (isTauri()) {
      const hasPermission = await checkScreenRecordingPermission()
      if (!hasPermission) {
        throw new Error('Screen recording permission not granted')
      }

      // Start audio recording if enabled
      if (mergedOptions.enableAudio) {
        try {
          // Use 10-second chunks for faster transcription feedback
          await startAudioRecording(sessionId, 10, mergedOptions.selectedMicrophone)
          logger.info('🎤 Audio recording started')

          // Listen for audio chunk events from Rust (file-based)
          this.audioChunkListener = await listen<{
            sessionId: string;
            chunkId: string;
            audioPath: string;
            duration: number;
          }>('audio-chunk', async (event) => {
            const { sessionId: sid, chunkId, audioPath, duration } = event.payload;

            // Save audio chunk to database (fast - just stores path)
            try {
              const now = new Date();
              const startTime = new Date(now.getTime() - duration * 1000).toISOString();
              const endTime = now.toISOString();

              const chunk = await saveAudioChunk(
                sid,
                chunkId,
                audioPath,
                startTime,
                endTime,
                duration
              );

              logger.debug('[RECORDING] Audio chunk saved:', chunk.id, audioPath);

              // Load audio binary from file and send to AI Worker for transcription (zero-copy)
              try {
                const audioData = await loadAudioBinary(audioPath);
                aiWorker.transcribeAudioBinary(sid, chunk.id, audioData).catch((e) => {
                  logger.error('Audio transcription request error:', e);
                });
              } catch (loadError) {
                logger.error('Failed to load audio for transcription:', loadError);
              }
            } catch (e) {
              logger.error('Audio chunk processing error:', e);
            }
          });
          logger.debug('🎤 Audio chunk listener started')
          audioStarted = true

          // Start live transcription (streaming via WebSocket)
          try {
            await aiWorker.startLiveTranscription(sessionId)
            this.liveTranscriptionActive = true
            logger.info('🎤 Live transcription started')

            // Listen for PCM audio chunks from Rust and forward to worker
            this.audioPcmListener = await listen<{
              sessionId: string;
              pcmBase64: string;
              sampleRate: number;
              encoding: string;
            }>('audio-pcm', (event) => {
              if (!this.state?.isRecording || this.state?.isPaused) return

              try {
                // Decode base64 to binary
                const binaryString = atob(event.payload.pcmBase64)
                const bytes = new Uint8Array(binaryString.length)
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i)
                }
                // Send to worker with zero-copy transfer
                aiWorker.sendAudioPCM(event.payload.sessionId, bytes.buffer as ArrayBuffer)
              } catch (e) {
                logger.error('Failed to forward PCM audio:', e)
              }
            })
            logger.debug('🎤 PCM audio listener started')
          } catch (e) {
            logger.warn('Live transcription failed to start, falling back to batch:', e)
            this.liveTranscriptionActive = false
            // Batch transcription (existing WAV flow) will still work as fallback
          }
        } catch (e) {
          logger.error('Failed to start audio recording:', e)
          errors.push(`Audio recording failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
        }
      }

      // Start screenshot capture if enabled
      if (mergedOptions.enableScreenshots) {
        try {
          if (mergedOptions.smartCaptureEnabled) {
            // Use smart capture (event-driven) - activity monitor started inside
            await smartCapture.start(sessionId, mergedOptions.selectedScreen)
            logger.info('Smart capture started')
          } else {
            // Use interval-based capture - still start activity monitor for app tracking
            try {
              const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
              await tauriInvoke('start_activity_monitor')
              logger.info('Activity monitor started (interval mode)')
            } catch (e) {
              logger.warn('Failed to start activity monitor:', e)
            }
            this.startScreenshotCapture()
          }
          screenshotsStarted = true
        } catch (e) {
          logger.error('Failed to start screenshot capture:', e)
          errors.push(`Screenshot capture failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
        }
      }

      // Start video recording if enabled
      if (mergedOptions.enableVideo) {
        try {
          // Video output path will be in app data directory
          let outputPath = `session_${sessionId}.mp4`
          try {
            const { appDataDir, join } = await import('@tauri-apps/api/path')
            const dir = await appDataDir()
            outputPath = await join(dir, outputPath)
          } catch (pathError) {
            logger.warn('Failed to resolve app data dir, using relative path:', pathError)
          }
          await startVideoRecording(sessionId, outputPath)
          logger.info('🎬 Video recording started')
          videoStarted = true
        } catch (e) {
          logger.error('Failed to start video recording:', e)
          errors.push(`Video recording failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
        }
      }
    }

    logger.info('📹 Session recording started:', sessionId, mergedOptions)

    return {
      success: errors.length === 0,
      screenshotsEnabled: screenshotsStarted,
      audioEnabled: audioStarted,
      videoEnabled: videoStarted,
      errors,
    }
  }

  private startScreenshotCapture(): void {
    if (!this.state) return

    // Capture initial screenshot
    this.captureAndStoreScreenshot()

    // Set up interval using configured interval
    const intervalMs = this.state.options.screenshotIntervalMs
    this.screenshotInterval = setInterval(() => {
      if (this.state?.isRecording && !this.state?.isPaused) {
        this.captureAndStoreScreenshot()
      }
    }, intervalMs)
  }

  private async captureAndStoreScreenshot(): Promise<void> {
    if (!this.state || !isTauri()) return

    try {
      await captureAnalyzeScreenshot(
        this.state.sessionId,
        this.state.options.selectedScreen,
        'interval',
      )
      this.state.screenshotCount++
      logger.debug('Screenshot captured (' + this.state.screenshotCount + ' total)')
    } catch (e) {
      logger.error('Failed to capture screenshot:', e)
    }
  }

  async pauseRecording(): Promise<void> {
    if (!this.state?.isRecording) {
      throw new Error('Not recording')
    }

    this.state.isPaused = true

    if (isTauri()) {
      try {
        await pauseAudioRecording()
      } catch (e) {
        logger.error('Failed to pause audio:', e)
      }
    }

    logger.info('⏸️ Recording paused')
  }

  async resumeRecording(): Promise<void> {
    if (!this.state?.isRecording || !this.state?.isPaused) {
      throw new Error('Not paused')
    }

    // Resume audio recording if it was enabled
    if (isTauri() && this.state.options.enableAudio) {
      try {
        await resumeAudioRecording()
        logger.info('🎤 Audio recording resumed')
      } catch (e) {
        logger.error('Failed to resume audio:', e)
        // Continue anyway - audio might have been stopped
      }
    }

    this.state.isPaused = false
    logger.info('▶️ Recording resumed')
  }

  async stopRecording(): Promise<RecordingStopResult> {
    if (!this.state) {
      throw new Error('Not recording')
    }

    const { options } = this.state
    const errors: string[] = []
    let videoPath: string | null = null

    // Stop screenshot capture
    if (options.enableScreenshots) {
      if (options.smartCaptureEnabled) {
        try {
          await smartCapture.stop()
          logger.info('Smart capture stopped')
        } catch (e) {
          logger.error('Failed to stop smart capture:', e)
          errors.push('Screenshot capture failed to stop properly')
        }
      } else {
        // Stop interval-based capture
        if (this.screenshotInterval) {
          clearInterval(this.screenshotInterval)
          this.screenshotInterval = null
        }
        // Stop activity monitor (started in interval mode)
        if (isTauri()) {
          try {
            const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
            await tauriInvoke('stop_activity_monitor')
            logger.info('Activity monitor stopped')
          } catch (e) {
            logger.warn('Failed to stop activity monitor:', e)
          }
        }
        // Capture final screenshot
        try {
          await this.captureAndStoreScreenshot()
        } catch (e) {
          logger.error('Failed to capture final screenshot:', e)
          // Don't add to errors - final screenshot is nice-to-have
        }
      }
    }

    // Stop audio recording if it was enabled
    // IMPORTANT: Stop backend FIRST, then remove listener to avoid losing final chunks
    if (isTauri() && options.enableAudio) {
      // Stop live transcription first (closes WebSocket)
      if (this.liveTranscriptionActive && this.state) {
        try {
          await aiWorker.stopLiveTranscription(this.state.sessionId)
          logger.info('🎤 Live transcription stopped')
        } catch (e) {
          logger.error('Failed to stop live transcription:', e)
        }
        this.liveTranscriptionActive = false
      }

      // Remove PCM listener
      if (this.audioPcmListener) {
        this.audioPcmListener()
        this.audioPcmListener = null
      }

      try {
        await stopAudioRecording()
        logger.info('🎤 Audio recording stopped')
      } catch (e) {
        logger.error('Failed to stop audio:', e)
        errors.push('Audio recording may still be active')
      }

      // Remove listener AFTER backend stops to catch any final chunks
      if (this.audioChunkListener) {
        this.audioChunkListener()
        this.audioChunkListener = null
      }
    }

    // Stop video recording if it was enabled
    if (isTauri() && options.enableVideo) {
      try {
        videoPath = await stopVideoRecording()
        logger.info('🎬 Video recording stopped')
      } catch (e) {
        logger.error('Failed to stop video:', e)
        errors.push('Video recording may still be active')
      }
    }

    const result: RecordingStopResult = {
      ...this.state,
      isRecording: false,
      videoPath: videoPath ?? this.state.videoPath,
      stopErrors: errors.length > 0 ? errors : undefined
    }

    logger.info(`📹 Session recording stopped: ${result.screenshotCount} screenshots`)

    this.state = null

    // Log warnings if there were errors
    if (errors.length > 0) {
      logger.warn('Recording stopped with errors:', errors)
    }

    return result
  }

  getState(): SessionRecordingState | null {
    return this.state ? { ...this.state } : null
  }

  isRecording(): boolean {
    return this.state?.isRecording ?? false
  }
}

export const sessionRecorder = new SessionRecordingController()
