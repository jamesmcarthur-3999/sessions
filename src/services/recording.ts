/**
 * Recording Service
 *
 * Handles session recording via Tauri backend:
 * - Screenshot capture at intervals
 * - Audio recording
 * - Video recording (macOS)
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { saveScreenshot } from './database'
import { sessionCoordinator } from './session-coordinator'
import { smartCapture } from './smart-capture'

// Type-safe invoke wrapper
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  // Check if we're in Tauri environment
  if (typeof window !== 'undefined' && '__TAURI__' in window) {
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
    return tauriInvoke<T>(cmd, args)
  }
  throw new Error('Not running in Tauri environment')
}

// Check if running in Tauri
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window
}

// ============================================================================
// Screenshot Capture
// ============================================================================

export async function captureScreenshot(screenId?: string | null): Promise<string> {
  return invoke<string>('capture_screenshot', { screenId: screenId ?? null })
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
  return invoke('start_audio_recording', {
    sessionId,
    chunkDurationSecs: chunkDurationSecs ?? 120,
    deviceId: deviceId ?? null,
  })
}

export async function pauseAudioRecording(): Promise<void> {
  return invoke('pause_audio_recording')
}

export async function resumeAudioRecording(): Promise<void> {
  return invoke('resume_audio_recording')
}

export async function stopAudioRecording(): Promise<void> {
  return invoke('stop_audio_recording')
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
  return invoke('start_video_recording', {
    sessionId,
    outputPath,
    quality,
  })
}

export async function stopVideoRecording(): Promise<string> {
  return invoke<string>('stop_video_recording')
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
  screenshots: string[]
  audioChunks: string[]
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
      screenshots: [],
      audioChunks: [],
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
          await startAudioRecording(sessionId, 120, mergedOptions.selectedMicrophone)
          console.log('🎤 Audio recording started')

          // Listen for audio chunk events from Rust
          this.audioChunkListener = await listen<{
            sessionId: string;
            audioBase64: string;
            duration: number;
          }>('audio-chunk', async (event) => {
            const { sessionId: sid, audioBase64, duration } = event.payload;

            // Process through coordinator for transcription
            try {
              await sessionCoordinator.processAudioChunk(
                sid,
                audioBase64,
                duration
              );
            } catch (e) {
              // Error is already handled/emitted by coordinator
              // Just log here to prevent unhandled rejection
              console.error('Audio chunk processing error:', e);
            }
          });
          console.log('🎤 Audio chunk listener started')
          audioStarted = true
        } catch (e) {
          console.error('Failed to start audio recording:', e)
          errors.push(`Audio recording failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
        }
      }

      // Start screenshot capture if enabled
      if (mergedOptions.enableScreenshots) {
        try {
          if (mergedOptions.smartCaptureEnabled) {
            // Use smart capture (event-driven) - activity monitor started inside
            await smartCapture.start(sessionId, mergedOptions.selectedScreen, {
              maxIntervalMs: mergedOptions.screenshotIntervalMs,
            })
            console.log('Smart capture started')
          } else {
            // Use interval-based capture - still start activity monitor for app tracking
            try {
              const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
              await tauriInvoke('start_activity_monitor')
              console.log('Activity monitor started (interval mode)')
            } catch (e) {
              console.warn('Failed to start activity monitor:', e)
            }
            this.startScreenshotCapture()
          }
          screenshotsStarted = true
        } catch (e) {
          console.error('Failed to start screenshot capture:', e)
          errors.push(`Screenshot capture failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
        }
      }

      // Start video recording if enabled
      if (mergedOptions.enableVideo) {
        try {
          // Video output path will be in app data directory
          const outputPath = `session_${sessionId}.mp4`
          await startVideoRecording(sessionId, outputPath)
          console.log('🎬 Video recording started')
          videoStarted = true
        } catch (e) {
          console.error('Failed to start video recording:', e)
          errors.push(`Video recording failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
        }
      }
    }

    console.log('📹 Session recording started:', sessionId, mergedOptions)

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
      const screenshot = await captureScreenshot(this.state.options.selectedScreen)
      this.state.screenshots.push(screenshot)

      // Save to database and notify coordinator
      try {
        const dbScreenshot = await saveScreenshot(
          this.state.sessionId,
          screenshot,
          'interval' // This method is only used for interval-based capture; smart capture handles its own triggers
        )
        // Notify coordinator for analysis (fire and forget)
        sessionCoordinator.processScreenshot(this.state.sessionId, dbScreenshot).catch(console.error)
      } catch (dbError) {
        console.error('Failed to save screenshot to database:', dbError)
      }

      console.log('Screenshot captured (' + this.state.screenshots.length + ' total)')
    } catch (e) {
      console.error('Failed to capture screenshot:', e)
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
        console.error('Failed to pause audio:', e)
      }
    }

    console.log('⏸️ Recording paused')
  }

  async resumeRecording(): Promise<void> {
    if (!this.state?.isRecording || !this.state?.isPaused) {
      throw new Error('Not paused')
    }

    // Resume audio recording if it was enabled
    if (isTauri() && this.state.options.enableAudio) {
      try {
        await resumeAudioRecording()
        console.log('🎤 Audio recording resumed')
      } catch (e) {
        console.error('Failed to resume audio:', e)
        // Continue anyway - audio might have been stopped
      }
    }

    this.state.isPaused = false
    console.log('▶️ Recording resumed')
  }

  async stopRecording(): Promise<SessionRecordingState> {
    if (!this.state) {
      throw new Error('Not recording')
    }

    const { options } = this.state
    const errors: string[] = []

    // Stop screenshot capture
    if (options.enableScreenshots) {
      if (options.smartCaptureEnabled) {
        try {
          await smartCapture.stop()
          console.log('Smart capture stopped')
        } catch (e) {
          console.error('Failed to stop smart capture:', e)
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
            console.log('Activity monitor stopped')
          } catch (e) {
            console.warn('Failed to stop activity monitor:', e)
          }
        }
        // Capture final screenshot
        try {
          await this.captureAndStoreScreenshot()
        } catch (e) {
          console.error('Failed to capture final screenshot:', e)
          // Don't add to errors - final screenshot is nice-to-have
        }
      }
    }

    // Stop audio recording if it was enabled
    if (isTauri() && options.enableAudio) {
      if (this.audioChunkListener) {
        this.audioChunkListener()
        this.audioChunkListener = null
      }

      try {
        await stopAudioRecording()
        console.log('🎤 Audio recording stopped')
      } catch (e) {
        console.error('Failed to stop audio:', e)
        errors.push('Audio recording may still be active')
      }
    }

    // Stop video recording if it was enabled
    if (isTauri() && options.enableVideo) {
      try {
        await stopVideoRecording()
        console.log('🎬 Video recording stopped')
      } catch (e) {
        console.error('Failed to stop video:', e)
        errors.push('Video recording may still be active')
      }
    }

    const result = { ...this.state }
    result.isRecording = false

    console.log(`📹 Session recording stopped: ${result.screenshots.length} screenshots`)

    this.state = null

    // If there were errors, include them in result for caller to handle
    if (errors.length > 0) {
      console.warn('Recording stopped with errors:', errors)
      // Attach errors to result for caller to handle
      ;(result as any).stopErrors = errors
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
