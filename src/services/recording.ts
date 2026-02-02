/**
 * Recording Service
 *
 * Handles session recording via Tauri backend:
 * - Screenshot capture at intervals
 * - Audio recording
 * - Video recording (macOS)
 */

import { saveScreenshot } from './database'
import { sessionCoordinator } from './session-coordinator'

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

const defaultOptions: RecordingOptions = {
  enableScreenshots: true,
  enableAudio: false,
  enableVideo: false,
  screenshotIntervalMs: 30000,
  selectedMicrophone: null,
  selectedScreen: null,
}

class SessionRecordingController {
  private state: SessionRecordingState | null = null
  private screenshotInterval: ReturnType<typeof setInterval> | null = null

  async startRecording(sessionId: string, options: Partial<RecordingOptions> = {}): Promise<void> {
    if (this.state?.isRecording) {
      throw new Error('Already recording')
    }

    const mergedOptions = { ...defaultOptions, ...options }

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

    // Check and request permissions
    if (isTauri()) {
      const hasPermission = await checkScreenRecordingPermission()
      if (!hasPermission) {
        await requestScreenRecordingPermission()
      }

      // Start audio recording if enabled
      if (mergedOptions.enableAudio) {
        try {
          await startAudioRecording(sessionId, 120, mergedOptions.selectedMicrophone)
          console.log('🎤 Audio recording started')
        } catch (e) {
          console.error('Failed to start audio recording:', e)
        }
      }

      // Start screenshot capture interval if enabled
      if (mergedOptions.enableScreenshots) {
        this.startScreenshotCapture()
      }

      // Start video recording if enabled
      if (mergedOptions.enableVideo) {
        try {
          // Video output path will be in app data directory
          const outputPath = `session_${sessionId}.mp4`
          await startVideoRecording(sessionId, outputPath)
          console.log('🎬 Video recording started')
        } catch (e) {
          console.error('Failed to start video recording:', e)
        }
      }
    }

    console.log('📹 Session recording started:', sessionId, mergedOptions)
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
          'interval' // TODO: detect actual trigger
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

    this.state.isPaused = false
    console.log('▶️ Recording resumed')
  }

  async stopRecording(): Promise<SessionRecordingState> {
    if (!this.state) {
      throw new Error('Not recording')
    }

    const { options } = this.state

    // Stop screenshot interval
    if (this.screenshotInterval) {
      clearInterval(this.screenshotInterval)
      this.screenshotInterval = null
    }

    // Stop audio recording if it was enabled
    if (isTauri() && options.enableAudio) {
      try {
        await stopAudioRecording()
        console.log('🎤 Audio recording stopped')
      } catch (e) {
        console.error('Failed to stop audio:', e)
      }
    }

    // Stop video recording if it was enabled
    if (isTauri() && options.enableVideo) {
      try {
        await stopVideoRecording()
        console.log('🎬 Video recording stopped')
      } catch (e) {
        console.error('Failed to stop video:', e)
      }
    }

    // Capture final screenshot if screenshots were enabled
    if (options.enableScreenshots) {
      await this.captureAndStoreScreenshot()
    }

    const result = { ...this.state }
    result.isRecording = false

    console.log(`📹 Session recording stopped: ${result.screenshots.length} screenshots`)

    this.state = null
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
