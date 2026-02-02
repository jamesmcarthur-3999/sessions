# Intelligent Session Recording - Complete Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform session recording into an intelligent, responsive experience with event-driven capture, real-time AI analysis, audio transcription, adaptive analysis modes, and a rich marginalia UI.

**Architecture:** Event-driven capture system detects app switches, window focus, and activity patterns to trigger smart screenshots. Audio is continuously transcribed. Four AI bots (Activity Detector, Summarizer, Analysis Controller, Q&A) coordinate to provide real-time insights. The UI features peripheral glow, editorial marginalia cards, and an expandable intelligence panel.

**Tech Stack:**
- Baleybots SDK for AI orchestration (already integrated)
- SQLite via tauri-plugin-sql (already integrated)
- Tauri event system for Rust ↔ React communication
- Web Audio API for audio visualization
- Framer Motion for animations

**Current State:** Basic infrastructure exists (database schema, bot structure, session coordinator, hooks). Missing: event-driven capture, transcription, adaptive analysis, UI components.

---

## Phase 1: Event-Driven Smart Capture System

### Task 1: Add Tauri Event Listeners for System Events

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/activity_monitor.rs`

**Step 1: Create activity monitor module**

Create `src-tauri/src/activity_monitor.rs`:

```rust
//! Activity Monitor
//!
//! Monitors system events to trigger smart screenshots:
//! - Application switches
//! - Window focus changes
//! - Mouse activity after idle
//! - Keyboard activity bursts
//! - Clipboard changes

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Events emitted to the frontend
#[derive(Clone, serde::Serialize)]
pub struct ActivityEvent {
    pub event_type: String,
    pub app_name: Option<String>,
    pub window_title: Option<String>,
    pub timestamp: u64,
}

/// Activity monitor state
pub struct ActivityMonitor {
    is_running: AtomicBool,
    last_app: std::sync::Mutex<Option<String>>,
    last_window: std::sync::Mutex<Option<String>>,
    last_activity: AtomicU64,
    idle_threshold_ms: u64,
}

impl ActivityMonitor {
    pub fn new() -> Self {
        Self {
            is_running: AtomicBool::new(false),
            last_app: std::sync::Mutex::new(None),
            last_window: std::sync::Mutex::new(None),
            last_activity: AtomicU64::new(0),
            idle_threshold_ms: 5000, // 5 seconds idle threshold
        }
    }

    /// Start monitoring for activity
    pub fn start(&self, app_handle: AppHandle) -> Result<(), String> {
        if self.is_running.load(Ordering::SeqCst) {
            return Ok(());
        }
        self.is_running.store(true, Ordering::SeqCst);

        let is_running = self.is_running.clone();

        // Spawn monitoring thread
        std::thread::spawn(move || {
            let mut last_check = Instant::now();

            while is_running.load(Ordering::SeqCst) {
                // Poll every 500ms
                std::thread::sleep(Duration::from_millis(500));

                // Get frontmost application (macOS)
                if let Some((app_name, window_title)) = get_frontmost_app() {
                    // Emit event for frontend to handle
                    let event = ActivityEvent {
                        event_type: "app_check".to_string(),
                        app_name: Some(app_name),
                        window_title: Some(window_title),
                        timestamp: std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis() as u64,
                    };

                    let _ = app_handle.emit("activity-event", event);
                }

                last_check = Instant::now();
            }
        });

        Ok(())
    }

    pub fn stop(&self) {
        self.is_running.store(false, Ordering::SeqCst);
    }
}

/// Get the frontmost application name and window title (macOS)
#[cfg(target_os = "macos")]
fn get_frontmost_app() -> Option<(String, String)> {
    use std::process::Command;

    // Use AppleScript to get frontmost app
    let output = Command::new("osascript")
        .arg("-e")
        .arg(r#"
            tell application "System Events"
                set frontApp to first application process whose frontmost is true
                set appName to name of frontApp
                try
                    set winTitle to name of front window of frontApp
                on error
                    set winTitle to ""
                end try
                return appName & "|" & winTitle
            end tell
        "#)
        .output()
        .ok()?;

    let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parts: Vec<&str> = result.splitn(2, '|').collect();

    if parts.len() >= 1 {
        Some((
            parts[0].to_string(),
            parts.get(1).unwrap_or(&"").to_string(),
        ))
    } else {
        None
    }
}

#[cfg(not(target_os = "macos"))]
fn get_frontmost_app() -> Option<(String, String)> {
    None // Not implemented for other platforms yet
}

impl Default for ActivityMonitor {
    fn default() -> Self {
        Self::new()
    }
}
```

**Step 2: Register activity monitor in lib.rs**

In `src-tauri/src/lib.rs`, add at the top:

```rust
mod activity_monitor;

use activity_monitor::ActivityMonitor;
```

Add commands after the existing commands:

```rust
// ============================================================================
// Activity Monitoring Commands
// ============================================================================

#[tauri::command]
fn start_activity_monitor(
    app_handle: tauri::AppHandle,
    monitor: tauri::State<'_, Arc<Mutex<ActivityMonitor>>>,
) -> Result<(), String> {
    let monitor = monitor.lock()
        .map_err(|e| format!("Failed to lock activity monitor: {}", e))?;
    monitor.start(app_handle)
}

#[tauri::command]
fn stop_activity_monitor(
    monitor: tauri::State<'_, Arc<Mutex<ActivityMonitor>>>,
) -> Result<(), String> {
    let monitor = monitor.lock()
        .map_err(|e| format!("Failed to lock activity monitor: {}", e))?;
    monitor.stop();
    Ok(())
}
```

Update the `run()` function to include the activity monitor:

```rust
pub fn run() {
    let audio_recorder = Arc::new(Mutex::new(AudioRecorder::new()));
    let video_recorder = Arc::new(Mutex::new(VideoRecorder::new()));
    let activity_monitor = Arc::new(Mutex::new(ActivityMonitor::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .manage(audio_recorder.clone())
        .manage(video_recorder)
        .manage(activity_monitor)
        // ... rest of setup
        .invoke_handler(tauri::generate_handler![
            // ... existing handlers
            start_activity_monitor,
            stop_activity_monitor,
        ])
```

**Step 3: Verify Rust compiles**

Run:
```bash
cd /Users/jamesmcarthur/sessions/src-tauri && cargo check
```

Expected: Compiles with no errors

**Step 4: Commit**

```bash
git add src-tauri/src/activity_monitor.rs src-tauri/src/lib.rs
git commit -m "feat: add activity monitor for smart capture triggers"
```

---

### Task 2: Create Smart Capture Service in TypeScript

**Files:**
- Create: `src/services/smart-capture.ts`
- Modify: `src/services/recording.ts`

**Step 1: Create smart capture service**

Create `src/services/smart-capture.ts`:

```typescript
/**
 * Smart Capture Service
 *
 * Manages event-driven screenshot capture based on:
 * - Application switches
 * - Window focus changes
 * - Activity after idle periods
 * - Keyboard bursts
 * - Maximum interval fallback (1 minute)
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { saveScreenshot } from './database';
import { sessionCoordinator } from './session-coordinator';
import { captureScreenshot, isTauri } from './recording';
import type { DbScreenshot } from '../types/database';

interface ActivityEvent {
  event_type: string;
  app_name: string | null;
  window_title: string | null;
  timestamp: number;
}

interface SmartCaptureConfig {
  enabled: boolean;
  maxIntervalMs: number;      // Maximum time between captures (fallback)
  minIntervalMs: number;      // Minimum time between captures (debounce)
  idleThresholdMs: number;    // Time to consider user idle
}

const defaultConfig: SmartCaptureConfig = {
  enabled: true,
  maxIntervalMs: 60000,       // 1 minute max
  minIntervalMs: 3000,        // 3 second debounce
  idleThresholdMs: 5000,      // 5 seconds idle
};

class SmartCaptureService {
  private config: SmartCaptureConfig = defaultConfig;
  private sessionId: string | null = null;
  private screenId: string | null = null;
  private isRunning = false;

  // State tracking
  private lastApp: string | null = null;
  private lastWindow: string | null = null;
  private lastCaptureTime = 0;
  private lastActivityTime = 0;

  // Listeners and timers
  private unlisten: UnlistenFn | null = null;
  private fallbackInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Start smart capture for a session
   */
  async start(
    sessionId: string,
    screenId: string | null,
    config: Partial<SmartCaptureConfig> = {}
  ): Promise<void> {
    if (this.isRunning) {
      console.warn('Smart capture already running');
      return;
    }

    this.sessionId = sessionId;
    this.screenId = screenId;
    this.config = { ...defaultConfig, ...config };
    this.isRunning = true;
    this.lastCaptureTime = Date.now();
    this.lastActivityTime = Date.now();

    if (!isTauri()) {
      console.log('Smart capture: browser mode, using interval only');
      this.startFallbackInterval();
      return;
    }

    // Listen for activity events from Rust
    this.unlisten = await listen<ActivityEvent>('activity-event', (event) => {
      this.handleActivityEvent(event.payload);
    });

    // Start activity monitor in Rust
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('start_activity_monitor');
      console.log('Smart capture: activity monitor started');
    } catch (e) {
      console.error('Failed to start activity monitor:', e);
    }

    // Start fallback interval
    this.startFallbackInterval();

    // Capture initial screenshot
    await this.captureNow('session_start');

    console.log('Smart capture started for session:', sessionId);
  }

  /**
   * Stop smart capture
   */
  async stop(): Promise<void> {
    this.isRunning = false;

    if (this.unlisten) {
      this.unlisten();
      this.unlisten = null;
    }

    if (this.fallbackInterval) {
      clearInterval(this.fallbackInterval);
      this.fallbackInterval = null;
    }

    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('stop_activity_monitor');
      } catch (e) {
        console.error('Failed to stop activity monitor:', e);
      }
    }

    // Capture final screenshot
    if (this.sessionId) {
      await this.captureNow('session_end');
    }

    this.sessionId = null;
    console.log('Smart capture stopped');
  }

  /**
   * Handle activity event from Rust
   */
  private async handleActivityEvent(event: ActivityEvent): Promise<void> {
    if (!this.isRunning || !this.sessionId) return;

    const now = Date.now();
    this.lastActivityTime = now;

    // Check for app switch
    if (event.app_name && event.app_name !== this.lastApp) {
      console.log('App switch detected:', this.lastApp, '->', event.app_name);
      this.lastApp = event.app_name;
      await this.captureIfAllowed('app_switch');
    }

    // Check for window change
    if (event.window_title && event.window_title !== this.lastWindow) {
      console.log('Window change detected:', event.window_title);
      this.lastWindow = event.window_title;
      // Don't capture on every window change, just track it
    }
  }

  /**
   * Capture screenshot if minimum interval has passed
   */
  private async captureIfAllowed(
    trigger: DbScreenshot['trigger']
  ): Promise<void> {
    const now = Date.now();
    const timeSinceLastCapture = now - this.lastCaptureTime;

    if (timeSinceLastCapture < this.config.minIntervalMs) {
      console.log('Capture skipped (debounce):', timeSinceLastCapture, 'ms');
      return;
    }

    await this.captureNow(trigger);
  }

  /**
   * Capture screenshot immediately
   */
  private async captureNow(
    trigger: DbScreenshot['trigger']
  ): Promise<void> {
    if (!this.sessionId || !isTauri()) return;

    try {
      const screenshot = await captureScreenshot(this.screenId);
      this.lastCaptureTime = Date.now();

      // Save to database
      const dbScreenshot = await saveScreenshot(
        this.sessionId,
        screenshot,
        trigger,
        this.lastApp ?? undefined,
        this.lastWindow ?? undefined
      );

      // Notify coordinator for AI analysis
      sessionCoordinator.processScreenshot(this.sessionId, dbScreenshot).catch(console.error);

      console.log(`Smart capture: ${trigger}`, {
        app: this.lastApp,
        window: this.lastWindow,
      });
    } catch (e) {
      console.error('Smart capture failed:', e);
    }
  }

  /**
   * Start fallback interval (max time between captures)
   */
  private startFallbackInterval(): void {
    this.fallbackInterval = setInterval(async () => {
      if (!this.isRunning || !this.sessionId) return;

      const now = Date.now();
      const timeSinceLastCapture = now - this.lastCaptureTime;

      // Capture if max interval exceeded
      if (timeSinceLastCapture >= this.config.maxIntervalMs) {
        await this.captureNow('interval');
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Manually trigger a capture
   */
  async manualCapture(): Promise<void> {
    if (this.sessionId) {
      await this.captureNow('manual');
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SmartCaptureConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current state
   */
  getState() {
    return {
      isRunning: this.isRunning,
      sessionId: this.sessionId,
      lastApp: this.lastApp,
      lastWindow: this.lastWindow,
      lastCaptureTime: this.lastCaptureTime,
    };
  }
}

export const smartCapture = new SmartCaptureService();
```

**Step 2: Update database trigger type**

In `src/types/database.ts`, update the trigger type:

```typescript
export interface DbScreenshot {
  id: string;
  session_id: string;
  captured_at: string;
  trigger: 'interval' | 'app_switch' | 'activity' | 'manual' | 'session_start' | 'session_end';
  app_name: string | null;
  window_title: string | null;
  data_base64: string;
  analysis: string | null;
}
```

**Step 3: Update database schema**

In `src/services/database.ts`, update the trigger CHECK constraint:

```typescript
-- Screenshots table
CREATE TABLE IF NOT EXISTS screenshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('interval', 'app_switch', 'activity', 'manual', 'session_start', 'session_end')),
  app_name TEXT,
  window_title TEXT,
  data_base64 TEXT NOT NULL,
  analysis TEXT
);
```

**Step 4: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

Expected: No errors

**Step 5: Commit**

```bash
git add src/services/smart-capture.ts src/types/database.ts src/services/database.ts
git commit -m "feat: add smart capture service with event-driven triggers"
```

---

### Task 3: Integrate Smart Capture into Recording Flow

**Files:**
- Modify: `src/services/recording.ts`
- Modify: `src/components/SessionRecording.tsx`
- Modify: `src/components/RecordingSettings.tsx`

**Step 1: Update recording service to use smart capture**

In `src/services/recording.ts`, add import and modify the controller:

```typescript
import { smartCapture } from './smart-capture';

// In RecordingOptions interface, add:
export interface RecordingOptions {
  enableScreenshots: boolean;
  enableAudio: boolean;
  enableVideo: boolean;
  screenshotIntervalMs: number;
  selectedMicrophone: string | null;
  selectedScreen: string | null;
  smartCaptureEnabled: boolean;  // NEW
}

// Update default options
const defaultOptions: RecordingOptions = {
  enableScreenshots: true,
  enableAudio: false,
  enableVideo: false,
  screenshotIntervalMs: 30000,
  selectedMicrophone: null,
  selectedScreen: null,
  smartCaptureEnabled: true,  // NEW - enabled by default
};

// In SessionRecordingController.startRecording(), replace screenshot capture logic:

// Replace the old startScreenshotCapture() section with:
if (mergedOptions.enableScreenshots) {
  if (mergedOptions.smartCaptureEnabled) {
    // Use smart capture (event-driven)
    await smartCapture.start(sessionId, mergedOptions.selectedScreen, {
      maxIntervalMs: mergedOptions.screenshotIntervalMs,
    });
  } else {
    // Use interval-based capture
    this.startScreenshotCapture();
  }
}

// In stopRecording(), add:
if (options.enableScreenshots && options.smartCaptureEnabled) {
  await smartCapture.stop();
} else if (this.screenshotInterval) {
  clearInterval(this.screenshotInterval);
  this.screenshotInterval = null;
}
```

**Step 2: Add Smart Capture toggle to RecordingSettings**

In `src/components/RecordingSettings.tsx`, add to the interface:

```typescript
export interface RecordingConfig {
  enableScreenshots: boolean;
  enableAudio: boolean;
  enableVideo: boolean;
  screenshotInterval: number;
  selectedMicrophone: string | null;
  selectedScreen: string | null;
  smartCaptureEnabled: boolean;  // NEW
}
```

Add the toggle UI after the screenshot interval selector (around line 200):

```tsx
{/* Smart Capture Toggle */}
{config.enableScreenshots && (
  <div className="mt-4 pt-4 border-t border-[var(--ink)]/10">
    <button
      onClick={() => onConfigChange({
        ...config,
        smartCaptureEnabled: !config.smartCaptureEnabled
      })}
      className="w-full flex items-center justify-between p-3 rounded-xl bg-[var(--paper)] border border-[var(--ink)]/10"
    >
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-[var(--success)]/20 flex items-center justify-center">
          <Zap className="w-4 h-4 text-[var(--success)]" />
        </div>
        <div className="text-left">
          <div className="font-medium">Smart Capture</div>
          <div className="text-sm text-[var(--ink)]/50">
            Capture on app switches & activity
          </div>
        </div>
      </div>
      <div className={`w-10 h-6 rounded-full transition-colors ${
        config.smartCaptureEnabled
          ? 'bg-[var(--success)]'
          : 'bg-[var(--ink)]/20'
      }`}>
        <div className={`w-5 h-5 rounded-full bg-white shadow-sm transform transition-transform mt-0.5 ${
          config.smartCaptureEnabled ? 'translate-x-4.5 ml-0.5' : 'translate-x-0.5'
        }`} />
      </div>
    </button>
  </div>
)}
```

Add `Zap` to the lucide-react import.

**Step 3: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/services/recording.ts src/components/RecordingSettings.tsx
git commit -m "feat: integrate smart capture into recording flow"
```

---

## Phase 2: Audio Transcription Pipeline

### Task 4: Add Whisper Transcription Service

**Files:**
- Create: `src/services/transcription.ts`
- Modify: `src/services/session-coordinator.ts`

**Step 1: Create transcription service**

Create `src/services/transcription.ts`:

```typescript
/**
 * Transcription Service
 *
 * Handles audio transcription using:
 * - OpenAI Whisper API (primary)
 * - Local Whisper (future)
 */

import { storage } from './storage';

interface TranscriptionResult {
  text: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
  language?: string;
}

interface TranscriptionConfig {
  provider: 'openai' | 'local';
  model: string;
}

const defaultConfig: TranscriptionConfig = {
  provider: 'openai',
  model: 'whisper-1',
};

class TranscriptionService {
  private config: TranscriptionConfig = defaultConfig;

  /**
   * Transcribe audio from base64 data
   */
  async transcribe(audioBase64: string): Promise<TranscriptionResult> {
    const apiKey = storage.getApiKey();

    if (!apiKey) {
      console.warn('No API key configured, skipping transcription');
      return { text: '' };
    }

    if (this.config.provider === 'openai') {
      return this.transcribeWithOpenAI(audioBase64, apiKey);
    }

    throw new Error(`Unsupported transcription provider: ${this.config.provider}`);
  }

  /**
   * Transcribe using OpenAI Whisper API
   */
  private async transcribeWithOpenAI(
    audioBase64: string,
    apiKey: string
  ): Promise<TranscriptionResult> {
    // Convert base64 to blob
    const binaryString = atob(audioBase64.replace(/^data:audio\/\w+;base64,/, ''));
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const audioBlob = new Blob([bytes], { type: 'audio/wav' });

    // Create form data
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.wav');
    formData.append('model', this.config.model);
    formData.append('response_format', 'verbose_json');

    try {
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Transcription failed: ${error}`);
      }

      const result = await response.json();

      return {
        text: result.text || '',
        segments: result.segments?.map((s: any) => ({
          start: s.start,
          end: s.end,
          text: s.text,
        })),
        language: result.language,
      };
    } catch (error) {
      console.error('Transcription error:', error);
      return { text: '' };
    }
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<TranscriptionConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

export const transcriptionService = new TranscriptionService();
```

**Step 2: Connect transcription to audio chunks**

In `src/services/session-coordinator.ts`, add method to process audio:

```typescript
import { transcriptionService } from './transcription';
import { updateAudioTranscript, saveAudioChunk } from './database';

// Add to SessionCoordinatorService class:

/**
 * Process a new audio chunk
 */
async processAudioChunk(
  sessionId: string,
  audioBase64: string,
  startTime: string,
  endTime: string,
  durationSeconds: number
): Promise<void> {
  // Save audio chunk to database
  const chunk = await saveAudioChunk(
    sessionId,
    startTime,
    endTime,
    durationSeconds,
    audioBase64
  );

  // Transcribe audio
  try {
    const result = await transcriptionService.transcribe(audioBase64);

    if (result.text) {
      // Update chunk with transcript
      await updateAudioTranscript(chunk.id, result.text);

      // Trigger summary update with new transcript
      await this.processTranscript(sessionId, result.text);

      console.log('Audio transcribed:', result.text.substring(0, 100) + '...');
    }
  } catch (error) {
    console.error('Transcription failed:', error);
  }
}
```

**Step 3: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/services/transcription.ts src/services/session-coordinator.ts
git commit -m "feat: add audio transcription pipeline with OpenAI Whisper"
```

---

### Task 5: Wire Audio Chunks from Rust to TypeScript

**Files:**
- Modify: `src-tauri/src/audio_capture.rs`
- Modify: `src/services/recording.ts`

**Step 1: Emit audio chunk events from Rust**

In `src-tauri/src/audio_capture.rs`, find where audio chunks are saved and add event emission:

```rust
// Add to the audio chunk completion handler:
use tauri::Emitter;

// When a chunk is complete:
if let Some(app_handle) = &self.app_handle {
    let _ = app_handle.emit("audio-chunk-ready", serde_json::json!({
        "session_id": &self.session_id,
        "chunk_path": &chunk_path,
        "start_time": start_time_iso,
        "end_time": end_time_iso,
        "duration_seconds": duration,
    }));
}
```

**Step 2: Listen for audio chunks in TypeScript**

In `src/services/recording.ts`, add audio chunk listener:

```typescript
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { sessionCoordinator } from './session-coordinator';

// In SessionRecordingController class, add:
private audioChunkListener: UnlistenFn | null = null;

// In startRecording(), after starting audio:
if (isTauri() && mergedOptions.enableAudio) {
  // Listen for audio chunk events
  this.audioChunkListener = await listen<{
    session_id: string;
    chunk_path: string;
    start_time: string;
    end_time: string;
    duration_seconds: number;
  }>('audio-chunk-ready', async (event) => {
    const { session_id, start_time, end_time, duration_seconds } = event.payload;

    // Read audio file and convert to base64
    try {
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const audioData = await readFile(event.payload.chunk_path);
      const base64 = btoa(String.fromCharCode(...audioData));

      // Process through coordinator
      await sessionCoordinator.processAudioChunk(
        session_id,
        base64,
        start_time,
        end_time,
        duration_seconds
      );
    } catch (e) {
      console.error('Failed to process audio chunk:', e);
    }
  });
}

// In stopRecording(), cleanup:
if (this.audioChunkListener) {
  this.audioChunkListener();
  this.audioChunkListener = null;
}
```

**Step 3: Verify compiles**

Run:
```bash
npx tsc --noEmit && cd src-tauri && cargo check
```

**Step 4: Commit**

```bash
git add src-tauri/src/audio_capture.rs src/services/recording.ts
git commit -m "feat: wire audio chunks from Rust to TypeScript for transcription"
```

---

## Phase 3: Adaptive Analysis Mode

### Task 6: Enhance Analysis Controller Bot

**Files:**
- Modify: `src/services/bots/analysis-controller.ts`
- Modify: `src/services/session-coordinator.ts`

**Step 1: Improve analysis controller with activity metrics**

In `src/services/bots/analysis-controller.ts`, update the input builder:

```typescript
export interface ActivityMetrics {
  appSwitchCount: number;           // Number of app switches in window
  uniqueAppsCount: number;          // Unique apps used
  screenshotCount: number;          // Screenshots in window
  audioWordCount: number;           // Words transcribed
  averageScreenshotChangeMagnitude: number; // 0-1 scale
  timeSinceLastActivity: number;    // Seconds
  currentFocusDuration: number;     // Seconds in current app
}

export function buildAnalysisControllerInput(
  context: SessionContext,
  metrics: ActivityMetrics
): string {
  const parts: string[] = [];

  parts.push(`## Current Mode: ${context.analysisMode}`);
  parts.push(`## Session Duration: ${Math.floor(context.durationSeconds / 60)} minutes`);

  // Activity metrics
  parts.push('\n## Activity Metrics (last 2 minutes):');
  parts.push(`- App switches: ${metrics.appSwitchCount}`);
  parts.push(`- Unique apps: ${metrics.uniqueAppsCount}`);
  parts.push(`- Screenshots: ${metrics.screenshotCount}`);
  parts.push(`- Audio words: ${metrics.audioWordCount}`);
  parts.push(`- Idle time: ${metrics.timeSinceLastActivity}s`);
  parts.push(`- Current focus: ${metrics.currentFocusDuration}s`);

  // Analysis guidance
  parts.push('\n## Mode Guidelines:');
  parts.push('- **Deep mode** triggers: >3 app switches, >50 words spoken, multi-app workflow');
  parts.push('- **Ambient mode** triggers: <2 app switches, no audio, single-app focus >5min');

  parts.push('\nBased on these metrics, should we change analysis mode?');

  return parts.join('\n');
}
```

**Step 2: Track activity metrics in coordinator**

In `src/services/session-coordinator.ts`, add metrics tracking:

```typescript
import type { ActivityMetrics } from './bots/analysis-controller';

// Add to class properties:
private activityMetrics = new Map<string, {
  appSwitches: string[];
  lastActivityTime: number;
  focusStartTime: number;
  currentApp: string | null;
}>();

// Add method to track activity:
private trackActivity(sessionId: string, appName: string | null): void {
  let metrics = this.activityMetrics.get(sessionId);

  if (!metrics) {
    metrics = {
      appSwitches: [],
      lastActivityTime: Date.now(),
      focusStartTime: Date.now(),
      currentApp: null,
    };
    this.activityMetrics.set(sessionId, metrics);
  }

  const now = Date.now();
  metrics.lastActivityTime = now;

  if (appName && appName !== metrics.currentApp) {
    metrics.appSwitches.push(appName);
    metrics.currentApp = appName;
    metrics.focusStartTime = now;

    // Keep only last 2 minutes of switches
    const twoMinutesAgo = now - 120000;
    // Filter based on timing would need timestamps...
  }
}

// Add method to compute metrics:
private computeActivityMetrics(sessionId: string, context: SessionContext): ActivityMetrics {
  const tracked = this.activityMetrics.get(sessionId);
  const now = Date.now();

  const appSwitches = tracked?.appSwitches || [];
  const uniqueApps = new Set(appSwitches);

  // Count words in recent transcripts
  const wordCount = context.recentTranscripts
    .join(' ')
    .split(/\s+/)
    .filter(w => w.length > 0).length;

  return {
    appSwitchCount: appSwitches.length,
    uniqueAppsCount: uniqueApps.size,
    screenshotCount: context.recentScreenshots.length,
    audioWordCount: wordCount,
    averageScreenshotChangeMagnitude: 0.5, // TODO: compute from analysis
    timeSinceLastActivity: tracked
      ? Math.floor((now - tracked.lastActivityTime) / 1000)
      : 0,
    currentFocusDuration: tracked
      ? Math.floor((now - tracked.focusStartTime) / 1000)
      : 0,
  };
}

// Update checkAnalysisMode to use metrics:
private async checkAnalysisMode(sessionId: string, context: SessionContext): Promise<void> {
  const bots = await this.ensureBots();
  const metrics = this.computeActivityMetrics(sessionId, context);

  try {
    const input = bots.buildAnalysisControllerInput(context, metrics);
    const result = await this.analysisControllerBot!.process(input);

    if (result.confidence > 0.7 && result.recommendedMode !== context.analysisMode) {
      await updateAnalysisMode(sessionId, result.recommendedMode);
      this.emitter.emit('mode-changed', {
        sessionId,
        mode: result.recommendedMode,
        reason: result.reason,
      });

      // Adjust capture frequency based on mode
      this.adjustCaptureFrequency(sessionId, result.recommendedMode);
    }
  } catch (error) {
    console.error('Analysis mode check error:', error);
  }
}

// Add method to adjust capture frequency:
private adjustCaptureFrequency(sessionId: string, mode: 'ambient' | 'deep'): void {
  // Emit event for smart capture to adjust
  this.emitter.emit('mode-changed', {
    sessionId,
    mode,
    reason: mode === 'deep' ? 'High activity detected' : 'Low activity detected',
  });
}
```

**Step 3: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/services/bots/analysis-controller.ts src/services/session-coordinator.ts
git commit -m "feat: add adaptive analysis mode with activity metrics"
```

---

## Phase 4: Real-time Streaming UI

### Task 7: Create Live Session Panel Component

**Files:**
- Create: `src/components/LiveSessionPanel.tsx`
- Modify: `src/components/SessionRecording.tsx`

**Step 1: Create the live session panel**

Create `src/components/LiveSessionPanel.tsx`:

```tsx
/**
 * Live Session Panel
 *
 * Shows real-time session intelligence during recording:
 * - Rolling summary (updates as session progresses)
 * - Ephemeral insight cards
 * - Analysis mode indicator
 * - Quick chat input
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  MessageCircle,
  Pin,
  X,
  Sun,
  Moon,
  Send,
} from 'lucide-react';
import { useSessionIntelligence } from '../hooks/useSessionIntelligence';
import { useSessionChat } from '../hooks/useSessionChat';

interface LiveSessionPanelProps {
  sessionId: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export function LiveSessionPanel({
  sessionId,
  isExpanded,
  onToggleExpand,
}: LiveSessionPanelProps) {
  const {
    summary,
    insights,
    analysisMode,
    setAnalysisMode,
    pinInsight,
  } = useSessionIntelligence(sessionId);

  const {
    messages,
    isSending,
    sendMessage,
  } = useSessionChat(sessionId);

  const [chatInput, setChatInput] = useState('');
  const [ephemeralInsights, setEphemeralInsights] = useState<string[]>([]);

  // Filter for pinned vs ephemeral insights
  const pinnedInsights = insights.filter(i => i.pinned);
  const recentInsights = insights.filter(i => !i.pinned).slice(0, 3);

  // Auto-dismiss ephemeral insights
  useEffect(() => {
    if (recentInsights.length > 0) {
      const timer = setTimeout(() => {
        // Insights will naturally cycle out
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [recentInsights]);

  const handleSendMessage = async () => {
    if (!chatInput.trim() || isSending) return;
    const message = chatInput;
    setChatInput('');
    await sendMessage(message);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className={`fixed right-0 top-0 h-full bg-[var(--paper)] border-l border-[var(--ink)]/10 shadow-xl transition-all ${
        isExpanded ? 'w-96' : 'w-80'
      }`}
    >
      {/* Header */}
      <div className="p-4 border-b border-[var(--ink)]/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[var(--accent)]" />
            <span className="font-display text-lg">Live Intelligence</span>
          </div>
          <button
            onClick={onToggleExpand}
            className="p-2 rounded-lg hover:bg-[var(--ink)]/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Analysis Mode Toggle */}
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => setAnalysisMode('ambient')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors ${
              analysisMode === 'ambient'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-[var(--ink)]/5 text-[var(--ink)]/50'
            }`}
          >
            <Sun className="w-3.5 h-3.5" />
            Ambient
          </button>
          <button
            onClick={() => setAnalysisMode('deep')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors ${
              analysisMode === 'deep'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-[var(--ink)]/5 text-[var(--ink)]/50'
            }`}
          >
            <Moon className="w-3.5 h-3.5" />
            Deep
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Rolling Summary Card */}
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-4 border-l-4 border-[var(--accent)]">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-[var(--accent)]" />
            <span className="text-xs font-medium text-[var(--accent)] uppercase tracking-wide">
              Rolling Summary
            </span>
          </div>
          <p className="text-sm text-[var(--ink)]/80 leading-relaxed font-serif">
            {summary || 'Session just started. Summary will appear as you work...'}
          </p>
        </div>

        {/* Ephemeral Insights */}
        <AnimatePresence>
          {recentInsights.map((insight) => (
            <motion.div
              key={insight.id}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="bg-white rounded-xl p-3 border border-[var(--ink)]/10 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-[var(--ink)]/70">{insight.content}</p>
                <button
                  onClick={() => pinInsight(insight.id, true)}
                  className="p-1 rounded hover:bg-[var(--ink)]/5"
                >
                  <Pin className="w-3.5 h-3.5 text-[var(--ink)]/30" />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Pinned Insights */}
        {pinnedInsights.length > 0 && (
          <div className="space-y-2">
            <span className="text-xs font-medium text-[var(--ink)]/40 uppercase tracking-wide">
              Pinned
            </span>
            {pinnedInsights.map((insight) => (
              <div
                key={insight.id}
                className="bg-white rounded-xl p-3 border border-[var(--accent)]/30 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-[var(--ink)]/70">{insight.content}</p>
                  <button
                    onClick={() => pinInsight(insight.id, false)}
                    className="p-1 rounded hover:bg-[var(--ink)]/5"
                  >
                    <Pin className="w-3.5 h-3.5 text-[var(--accent)]" fill="currentColor" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Chat Input */}
      {isExpanded && (
        <div className="p-4 border-t border-[var(--ink)]/10">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Ask about your session..."
              className="flex-1 px-3 py-2 rounded-lg bg-[var(--ink)]/5 border-none outline-none text-sm"
            />
            <button
              onClick={handleSendMessage}
              disabled={isSending || !chatInput.trim()}
              className="p-2 rounded-lg bg-[var(--accent)] text-white disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
```

**Step 2: Integrate panel into SessionRecording**

In `src/components/SessionRecording.tsx`, add the panel:

```tsx
import { LiveSessionPanel } from './LiveSessionPanel';

// Add state for panel:
const [showIntelligence, setShowIntelligence] = useState(false);

// Add keyboard shortcut:
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey && e.key === 'i') {
      e.preventDefault();
      setShowIntelligence(prev => !prev);
    }
  };
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, []);

// Add panel to the JSX (before closing motion.div):
<AnimatePresence>
  {showIntelligence && !isEnding && (
    <LiveSessionPanel
      sessionId={sessionIdRef.current}
      isExpanded={showIntelligence}
      onToggleExpand={() => setShowIntelligence(false)}
    />
  )}
</AnimatePresence>

// Add toggle button in the recording UI:
<button
  onClick={() => setShowIntelligence(true)}
  className="absolute top-4 right-4 p-2 rounded-lg bg-[var(--paper)]/10 hover:bg-[var(--paper)]/20"
>
  <Sparkles className="w-5 h-5 text-[var(--paper)]" />
</button>
```

**Step 3: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/components/LiveSessionPanel.tsx src/components/SessionRecording.tsx
git commit -m "feat: add live session intelligence panel"
```

---

### Task 8: Add Peripheral Glow Effect

**Files:**
- Create: `src/components/PeripheralGlow.tsx`
- Modify: `src/components/SessionRecording.tsx`

**Step 1: Create peripheral glow component**

Create `src/components/PeripheralGlow.tsx`:

```tsx
/**
 * Peripheral Glow
 *
 * Ambient edge glow that communicates session state:
 * - Audio response: brightness/movement with voice
 * - Analysis mode: warm amber (ambient) / cool blue (deep)
 * - Capture heartbeat: golden ripple on screenshot
 */

import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';

interface PeripheralGlowProps {
  analysisMode: 'ambient' | 'deep';
  audioLevel: number; // 0-1
  onCapture?: boolean; // Flash on capture
}

export function PeripheralGlow({
  analysisMode,
  audioLevel,
  onCapture,
}: PeripheralGlowProps) {
  const [captureFlash, setCaptureFlash] = useState(false);

  // Flash on capture
  useEffect(() => {
    if (onCapture) {
      setCaptureFlash(true);
      const timer = setTimeout(() => setCaptureFlash(false), 300);
      return () => clearTimeout(timer);
    }
  }, [onCapture]);

  // Color based on mode
  const baseColor = analysisMode === 'ambient'
    ? 'rgba(251, 191, 36, ' // amber
    : 'rgba(59, 130, 246, '; // blue

  // Intensity based on audio
  const intensity = 0.1 + (audioLevel * 0.3);

  return (
    <>
      {/* Top glow */}
      <div
        className="fixed top-0 left-0 right-0 h-32 pointer-events-none"
        style={{
          background: `linear-gradient(to bottom, ${baseColor}${intensity}), transparent)`,
          transition: 'background 0.3s ease',
        }}
      />

      {/* Bottom glow */}
      <div
        className="fixed bottom-0 left-0 right-0 h-32 pointer-events-none"
        style={{
          background: `linear-gradient(to top, ${baseColor}${intensity}), transparent)`,
          transition: 'background 0.3s ease',
        }}
      />

      {/* Left glow */}
      <div
        className="fixed top-0 bottom-0 left-0 w-32 pointer-events-none"
        style={{
          background: `linear-gradient(to right, ${baseColor}${intensity}), transparent)`,
          transition: 'background 0.3s ease',
        }}
      />

      {/* Right glow */}
      <div
        className="fixed top-0 bottom-0 right-0 w-32 pointer-events-none"
        style={{
          background: `linear-gradient(to left, ${baseColor}${intensity}), transparent)`,
          transition: 'background 0.3s ease',
        }}
      />

      {/* Capture flash overlay */}
      {captureFlash && (
        <motion.div
          initial={{ opacity: 0.5 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(circle at center, rgba(251, 191, 36, 0.3), transparent 70%)',
          }}
        />
      )}

      {/* Audio breathing effect */}
      <motion.div
        animate={{
          scale: [1, 1 + audioLevel * 0.02, 1],
          opacity: [0.5, 0.5 + audioLevel * 0.3, 0.5],
        }}
        transition={{
          duration: 0.5,
          repeat: Infinity,
          repeatType: 'reverse',
        }}
        className="fixed inset-0 pointer-events-none"
        style={{
          boxShadow: `inset 0 0 100px ${baseColor}${intensity * 0.5})`,
        }}
      />
    </>
  );
}
```

**Step 2: Add audio level tracking**

In `src/components/SessionRecording.tsx`:

```tsx
import { PeripheralGlow } from './PeripheralGlow';

// Add state:
const [audioLevel, setAudioLevel] = useState(0);
const [captureFlash, setCaptureFlash] = useState(false);
const { analysisMode } = useSessionIntelligence(sessionIdRef.current);

// Listen for screenshot captures to trigger flash:
useEffect(() => {
  const unsubscribe = sessionCoordinator.on('activity-detected', () => {
    setCaptureFlash(true);
    setTimeout(() => setCaptureFlash(false), 100);
  });
  return unsubscribe;
}, []);

// Add to JSX (at the top of the return):
<PeripheralGlow
  analysisMode={analysisMode}
  audioLevel={audioLevel}
  onCapture={captureFlash}
/>
```

**Step 3: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/components/PeripheralGlow.tsx src/components/SessionRecording.tsx
git commit -m "feat: add peripheral glow with audio response and analysis mode colors"
```

---

## Phase 5: Enhanced Recording Settings

### Task 9: Add Analysis Mode to Recording Settings

**Files:**
- Modify: `src/components/RecordingSettings.tsx`

**Step 1: Add analysis mode selector**

In `src/components/RecordingSettings.tsx`, add to `RecordingConfig`:

```typescript
export interface RecordingConfig {
  enableScreenshots: boolean;
  enableAudio: boolean;
  enableVideo: boolean;
  screenshotInterval: number;
  selectedMicrophone: string | null;
  selectedScreen: string | null;
  smartCaptureEnabled: boolean;
  analysisMode: 'ambient' | 'deep' | 'adaptive'; // NEW
}
```

Add the UI selector (after Capture Modes section):

```tsx
{/* Analysis Mode */}
<div className="space-y-3">
  <h3 className="label-section">Analysis Mode</h3>

  <div className="space-y-2">
    <button
      onClick={() => onConfigChange({ ...config, analysisMode: 'adaptive' })}
      className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors ${
        config.analysisMode === 'adaptive'
          ? 'border-[var(--accent)] bg-[var(--accent)]/5'
          : 'border-[var(--ink)]/10 hover:bg-[var(--ink)]/5'
      }`}
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
        config.analysisMode === 'adaptive' ? 'bg-[var(--accent)]/20' : 'bg-[var(--ink)]/10'
      }`}>
        <Sparkles className={`w-4 h-4 ${
          config.analysisMode === 'adaptive' ? 'text-[var(--accent)]' : 'text-[var(--ink)]/50'
        }`} />
      </div>
      <div className="text-left flex-1">
        <div className="font-medium">Adaptive</div>
        <div className="text-sm text-[var(--ink)]/50">AI adjusts based on activity</div>
      </div>
      {config.analysisMode === 'adaptive' && (
        <Check className="w-5 h-5 text-[var(--accent)]" />
      )}
    </button>

    <button
      onClick={() => onConfigChange({ ...config, analysisMode: 'ambient' })}
      className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors ${
        config.analysisMode === 'ambient'
          ? 'border-amber-400 bg-amber-50'
          : 'border-[var(--ink)]/10 hover:bg-[var(--ink)]/5'
      }`}
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
        config.analysisMode === 'ambient' ? 'bg-amber-100' : 'bg-[var(--ink)]/10'
      }`}>
        <Sun className={`w-4 h-4 ${
          config.analysisMode === 'ambient' ? 'text-amber-600' : 'text-[var(--ink)]/50'
        }`} />
      </div>
      <div className="text-left flex-1">
        <div className="font-medium">Ambient</div>
        <div className="text-sm text-[var(--ink)]/50">Light analysis, less intrusive</div>
      </div>
      {config.analysisMode === 'ambient' && (
        <Check className="w-5 h-5 text-amber-600" />
      )}
    </button>

    <button
      onClick={() => onConfigChange({ ...config, analysisMode: 'deep' })}
      className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors ${
        config.analysisMode === 'deep'
          ? 'border-blue-400 bg-blue-50'
          : 'border-[var(--ink)]/10 hover:bg-[var(--ink)]/5'
      }`}
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
        config.analysisMode === 'deep' ? 'bg-blue-100' : 'bg-[var(--ink)]/10'
      }`}>
        <Moon className={`w-4 h-4 ${
          config.analysisMode === 'deep' ? 'text-blue-600' : 'text-[var(--ink)]/50'
        }`} />
      </div>
      <div className="text-left flex-1">
        <div className="font-medium">Deep</div>
        <div className="text-sm text-[var(--ink)]/50">Full analysis, real-time insights</div>
      </div>
      {config.analysisMode === 'deep' && (
        <Check className="w-5 h-5 text-blue-600" />
      )}
    </button>
  </div>
</div>
```

Add imports: `Sun, Moon, Sparkles` from lucide-react.

**Step 2: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add src/components/RecordingSettings.tsx
git commit -m "feat: add analysis mode selector to recording settings"
```

---

## Phase 6: Session Keyboard Shortcuts

### Task 10: Add Session Recording Keyboard Shortcuts

**Files:**
- Modify: `src/components/SessionRecording.tsx`
- Modify: `src/hooks/useKeyboardShortcuts.ts`

**Step 1: Add session-specific shortcuts**

In `src/components/SessionRecording.tsx`, add comprehensive shortcuts:

```tsx
// Add keyboard shortcuts effect:
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Space: Pause/Resume
    if (e.code === 'Space' && !isEditingTitle && !isEnding) {
      e.preventDefault();
      handlePauseResume();
    }

    // ⌘+Enter: End session
    if (e.metaKey && e.key === 'Enter' && !isEnding) {
      e.preventDefault();
      handleEndSession();
    }

    // ⌘+I: Toggle intelligence panel
    if (e.metaKey && e.key === 'i') {
      e.preventDefault();
      setShowIntelligence(prev => !prev);
    }

    // ⌘+/: Focus chat input
    if (e.metaKey && e.key === '/') {
      e.preventDefault();
      setShowIntelligence(true);
      // Focus will be handled by panel
    }

    // Escape: Collapse intelligence panel
    if (e.key === 'Escape' && showIntelligence) {
      setShowIntelligence(false);
    }

    // ⌘+P: Pin current insight (TODO: needs insight selection)
    if (e.metaKey && e.key === 'p') {
      e.preventDefault();
      // Handled by LiveSessionPanel
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [isPaused, isEnding, isEditingTitle, showIntelligence]);
```

**Step 2: Add shortcut hints to UI**

Add a subtle shortcut hint at the bottom of the recording screen:

```tsx
{/* Keyboard shortcuts hint */}
<div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-4 text-xs text-[var(--paper)]/30">
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
```

**Step 3: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/components/SessionRecording.tsx
git commit -m "feat: add keyboard shortcuts for session recording"
```

---

## Verification

### Task 11: End-to-End Testing

**Step 1: Build and run the app**

```bash
npm run tauri:dev
```

**Step 2: Test smart capture**

1. Start a recording session with Smart Capture enabled
2. Switch between applications
3. Verify screenshots are captured on app switches (check console)
4. Verify fallback captures happen if idle

**Step 3: Test analysis modes**

1. In recording settings, select each analysis mode
2. Verify peripheral glow color changes (amber vs blue)
3. Verify adaptive mode changes based on activity

**Step 4: Test intelligence panel**

1. Press ⌘I to open intelligence panel
2. Verify rolling summary appears and updates
3. Verify insights appear and can be pinned
4. Test chat input

**Step 5: Test keyboard shortcuts**

1. Press Space to pause/resume
2. Press ⌘Enter to end session
3. Press ⌘I to toggle panel
4. Press Escape to close panel

---

## Summary

This plan implements the complete intelligent session recording system:

1. **Smart Capture (Tasks 1-3)**: Event-driven screenshots based on app switches, activity
2. **Audio Transcription (Tasks 4-5)**: Real-time transcription pipeline
3. **Adaptive Analysis (Task 6)**: Auto-adjusting analysis intensity
4. **Streaming UI (Tasks 7-8)**: Live panel, peripheral glow, insight cards
5. **Enhanced Settings (Task 9)**: Analysis mode selector
6. **Keyboard Shortcuts (Task 10)**: Full session control via keyboard

**What's NOT included (separate UI plan):**
- Timeline with thumbnail strip
- Full chat history in panel
- MCP integrations
- Multi-session context

---

## Next Steps

After this plan is complete:
1. Create UI polish plan for marginalia styling, animations
2. Add MCP integration for actions (create Linear ticket, etc.)
3. Add local Whisper option for transcription
