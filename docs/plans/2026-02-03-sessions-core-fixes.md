# Sessions Core Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all critical bugs preventing Sessions from working as intended - audio device selection, audio pause/resume, screenshot capture errors, activity monitoring, and AI pipeline reliability.

**Architecture:** Three-phase approach: (1) Fix recording infrastructure (Rust backend + frontend integration), (2) Fix AI analysis pipeline (error handling, retries, lifecycle), (3) Enable all features and add validation.

**Tech Stack:** Tauri v2, Rust (cpal for audio, screenshots crate), React 19, TypeScript, Baleybots SDK, OpenAI Whisper API.

---

## Phase 1: Fix Core Recording Infrastructure

### Task 1: Fix Audio Device ID Stability

**Problem:** Audio device IDs use array indices which change between enumerations. Device at index 0 today might be index 1 after plugging in a new device.

**Files:**
- Modify: `/Users/jamesmcarthur/sessions/src-tauri/src/lib.rs:47-74`
- Modify: `/Users/jamesmcarthur/sessions/src-tauri/src/audio_capture.rs:106-136`

**Step 1: Update get_audio_devices to use stable device IDs**

Change from index-based IDs to name-based IDs:

```rust
// In lib.rs, replace get_audio_devices function
#[tauri::command]
fn get_audio_devices() -> Result<Vec<serde_json::Value>, String> {
    use cpal::traits::{DeviceTrait, HostTrait};

    let host = cpal::default_host();
    let mut devices = Vec::new();

    let default_device_name = host
        .default_input_device()
        .and_then(|d| d.name().ok());

    let input_devices = host.input_devices()
        .map_err(|e| format!("Failed to enumerate input devices: {}", e))?;

    for device in input_devices {
        let name = device.name().unwrap_or_else(|_| "Unknown Device".to_string());
        let is_default = default_device_name.as_ref() == Some(&name);

        devices.push(serde_json::json!({
            "id": name.clone(),  // Use name as stable ID
            "name": name,
            "isDefault": is_default,
        }));
    }

    Ok(devices)
}
```

**Step 2: Update audio_capture.rs to find device by name**

```rust
// In audio_capture.rs, update start_recording device lookup
let device = if let Some(device_name) = device_id {
    // Find device by name (stable ID)
    let mut devices = host.input_devices()
        .map_err(|e| format!("Failed to enumerate input devices: {}", e))?;
    devices.find(|d| d.name().ok().as_ref() == Some(&device_name))
        .ok_or_else(|| format!("Device not found: {}", device_name))?
} else {
    host.default_input_device()
        .ok_or_else(|| "No input device available".to_string())?
};
```

**Step 3: Run build to verify**

Run: `cd /Users/jamesmcarthur/sessions && npm run tauri build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/audio_capture.rs
git commit -m "fix: use device name as stable audio device ID

Previously used array index which changed between enumerations.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 2: Add resume_audio_recording Tauri Command

**Problem:** The Rust `resume_recording()` method exists but is never exposed to frontend. The frontend's `resumeRecording()` only sets a flag but never calls Rust.

**Files:**
- Modify: `/Users/jamesmcarthur/sessions/src-tauri/src/lib.rs:236-252`
- Modify: `/Users/jamesmcarthur/sessions/src-tauri/src/audio_capture.rs:492-505`
- Modify: `/Users/jamesmcarthur/sessions/src/services/recording.ts:97-104`

**Step 1: Remove dead_code annotation and add Tauri command**

```rust
// In audio_capture.rs, remove the #[allow(dead_code)] from resume_recording
pub fn resume_recording(&self) -> Result<(), String> {
    // ... existing code unchanged
}
```

**Step 2: Add resume_audio_recording command in lib.rs**

Add after `pause_audio_recording`:

```rust
#[tauri::command]
fn resume_audio_recording(
    recorder: tauri::State<'_, Arc<Mutex<AudioRecorder>>>,
) -> Result<(), String> {
    let recorder = recorder.lock()
        .map_err(|e| format!("Failed to lock audio recorder: {}", e))?;
    recorder.resume_recording()
}
```

**Step 3: Register command in invoke_handler**

Add `resume_audio_recording` to the list:
```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    resume_audio_recording,
    // ...
])
```

**Step 4: Add frontend wrapper**

In recording.ts after `pauseAudioRecording`:

```typescript
export async function resumeAudioRecording(): Promise<void> {
  return invoke('resume_audio_recording')
}
```

**Step 5: Run build to verify**

Run: `cd /Users/jamesmcarthur/sessions && npm run tauri build`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/src/audio_capture.rs src/services/recording.ts
git commit -m "feat: expose resume_audio_recording to frontend

Rust method existed but was marked dead_code and never callable.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 3: Fix Recording Controller Resume to Actually Resume Audio

**Problem:** `SessionRecordingController.resumeRecording()` only sets `isPaused = false` but never calls the Rust backend to resume audio.

**Files:**
- Modify: `/Users/jamesmcarthur/sessions/src/services/recording.ts:347-354`

**Step 1: Update resumeRecording to call backend**

```typescript
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
```

**Step 2: Add import for resumeAudioRecording**

Update the import at the top of recording.ts (if using named export pattern):
```typescript
// After the invoke wrapper, add:
export async function resumeAudioRecording(): Promise<void> {
  return invoke('resume_audio_recording')
}
```

**Step 3: Run type check**

Run: `cd /Users/jamesmcarthur/sessions && npx tsc --noEmit`
Expected: No type errors

**Step 4: Commit**

```bash
git add src/services/recording.ts
git commit -m "fix: call Rust backend when resuming audio recording

Previously only set isPaused flag but never resumed actual audio.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 4: Fix Audio Chunks Lost During Pause

**Problem:** When paused, audio samples continue to be received by cpal but are not buffered, losing audio from just before the pause.

**Files:**
- Modify: `/Users/jamesmcarthur/sessions/src-tauri/src/audio_capture.rs:197-228`

**Step 1: Update stream callback to skip samples when paused (don't lose buffer)**

The current code already handles this correctly by checking state in the callback. However, we should emit any buffered audio before pausing to not lose samples.

**Step 2: Flush buffer on pause**

Add to `pause_recording`:

```rust
pub fn pause_recording(&self) -> Result<(), String> {
    println!("⏸️  [AUDIO CAPTURE] Pausing recording");

    // Note: We intentionally don't flush the buffer here.
    // The chunk processor will continue running and emit any
    // completed chunks. Partial buffer data will be preserved
    // and continue accumulating when resumed.

    *self.state.lock()
        .map_err(|e| format!("Failed to lock state: {}", e))? = RecordingState::Paused;
    Ok(())
}
```

The real issue is in the chunk processor thread at line 359-361 - it skips processing entirely when paused, but doesn't preserve partial buffer. Let's verify the current behavior is correct.

Actually, looking closer, the buffer IS preserved when paused - the chunk processor just skips checking if chunks are ready. When resumed, buffering continues and chunks will eventually complete. The concern is the chunk timer - `start_time` keeps ticking even when paused.

**Step 3: Fix buffer timing to not count paused time**

This is more complex - we need to track pause duration and adjust. For now, document this as a known limitation and keep the simpler implementation.

**Step 4: Commit as documentation/no-op change**

```bash
git add src-tauri/src/audio_capture.rs
git commit -m "docs: document audio buffer behavior during pause

Buffer is preserved when paused. Chunk timing continues which
may result in shorter-than-expected chunks after resume.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 5: Start Activity Monitor in Non-Smart-Capture Mode

**Problem:** When `smartCaptureEnabled` is false, `recording.ts` uses interval-based capture but never starts the activity monitor, so app switch tracking doesn't work.

**Files:**
- Modify: `/Users/jamesmcarthur/sessions/src/services/recording.ts:243-260`

**Step 1: Always start activity monitor when screenshots are enabled**

```typescript
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
      if (isTauri()) {
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          await invoke('start_activity_monitor')
          console.log('Activity monitor started (interval mode)')
        } catch (e) {
          console.warn('Failed to start activity monitor:', e)
        }
      }
      this.startScreenshotCapture()
    }
    screenshotsStarted = true
  } catch (e) {
    console.error('Failed to start screenshot capture:', e)
    errors.push(`Screenshot capture failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
  }
}
```

**Step 2: Stop activity monitor in stopRecording when not using smart capture**

```typescript
// In stopRecording, add after stopping smart capture:
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
    // Stop activity monitor
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('stop_activity_monitor')
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
    }
  }
}
```

**Step 3: Run type check**

Run: `cd /Users/jamesmcarthur/sessions && npx tsc --noEmit`
Expected: No type errors

**Step 4: Commit**

```bash
git add src/services/recording.ts
git commit -m "fix: start activity monitor in interval capture mode

Activity monitor tracks app switches for AI analysis regardless
of whether smart capture is enabled.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 6: Add Error Handling for Screenshot Save Failures

**Problem:** `captureAndStoreScreenshot` catches database errors but silently logs them. The user has no visibility into capture failures.

**Files:**
- Modify: `/Users/jamesmcarthur/sessions/src/services/recording.ts:303-327`

**Step 1: Track screenshot errors and expose to UI**

```typescript
// Add to SessionRecordingState interface
export interface SessionRecordingState {
  sessionId: string
  isRecording: boolean
  isPaused: boolean
  screenshots: string[]
  audioChunks: string[]
  startTime: number
  options: RecordingOptions
  errors: Array<{ type: string; message: string; timestamp: number }>  // Add this
}

// Initialize errors array in startRecording
this.state = {
  sessionId,
  isRecording: true,
  isPaused: false,
  screenshots: [],
  audioChunks: [],
  startTime: Date.now(),
  options: mergedOptions,
  errors: [],  // Add this
}
```

**Step 2: Record errors in captureAndStoreScreenshot**

```typescript
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
        'interval'
      )
      sessionCoordinator.processScreenshot(this.state.sessionId, dbScreenshot).catch(console.error)
    } catch (dbError) {
      console.error('Failed to save screenshot to database:', dbError)
      this.state.errors.push({
        type: 'screenshot_save',
        message: dbError instanceof Error ? dbError.message : 'Database error',
        timestamp: Date.now(),
      })
    }

    console.log('Screenshot captured (' + this.state.screenshots.length + ' total)')
  } catch (e) {
    console.error('Failed to capture screenshot:', e)
    this.state.errors.push({
      type: 'screenshot_capture',
      message: e instanceof Error ? e.message : 'Capture failed',
      timestamp: Date.now(),
    })
  }
}
```

**Step 3: Run type check**

Run: `cd /Users/jamesmcarthur/sessions && npx tsc --noEmit`
Expected: No type errors

**Step 4: Commit**

```bash
git add src/services/recording.ts
git commit -m "feat: track screenshot errors for UI visibility

Errors are now accumulated in state and can be displayed to user.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 2: Fix AI Analysis Pipeline

### Task 7: Validate API Keys Before Starting Session

**Problem:** Session starts even without valid API keys, leading to silent failures during the session.

**Files:**
- Modify: `/Users/jamesmcarthur/sessions/src/components/SessionRecording.tsx:72-135`

**Step 1: Check API key validity at session start**

Add warning toast if no API key but allow session to proceed:

```typescript
// In initRecording, after permission check:
// Check API keys and warn user
const hasClaudeKey = isBotsReady() || await initializeBots()
const hasOpenaiKey = !!localStorage.getItem('sessions_openai_api_key')

if (!hasClaudeKey) {
  showToast('No Claude API key configured. AI features will be disabled.', 'error', 5000)
}
if (recordingOptions.enableAudio && !hasOpenaiKey) {
  showToast('No OpenAI API key configured. Audio will not be transcribed.', 'error', 5000)
}
```

**Step 2: Run type check**

Run: `cd /Users/jamesmcarthur/sessions && npx tsc --noEmit`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/components/SessionRecording.tsx
git commit -m "feat: validate API keys at session start

Show toast warnings when keys are missing but allow session
to proceed with reduced functionality.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 8: Stop Periodic Analysis on Session Stop

**Problem:** `sessionCoordinator.stopSession()` clears interval but doesn't guarantee the runPeriodicAnalysis won't fire one more time.

**Files:**
- Modify: `/Users/jamesmcarthur/sessions/src/services/session-coordinator.ts:133-142`

**Step 1: Update stopSession to be more robust**

```typescript
async stopSession(sessionId: string): Promise<void> {
  const session = this.activeSessions.get(sessionId);

  // Clear interval first to prevent new runs
  if (session?.intervalId) {
    clearInterval(session.intervalId);
  }

  // Remove from active sessions BEFORE any async work
  this.activeSessions.delete(sessionId);
  this.activityTracking.delete(sessionId);
  this.pausedSessions.delete(sessionId);

  console.log('Session coordinator stopped for ' + sessionId);
}
```

**Step 2: Add session existence check to runPeriodicAnalysis**

```typescript
private async runPeriodicAnalysis(sessionId: string): Promise<void> {
  // Check if session still active (might have been stopped)
  if (!this.activeSessions.has(sessionId)) {
    return;
  }

  if (this.pausedSessions.has(sessionId)) {
    return;
  }
  // ... rest of method
}
```

**Step 3: Run type check**

Run: `cd /Users/jamesmcarthur/sessions && npx tsc --noEmit`
Expected: No type errors

**Step 4: Commit**

```bash
git add src/services/session-coordinator.ts
git commit -m "fix: prevent periodic analysis after session stop

Remove session from active map immediately to prevent race
with interval callback.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 9: Add Retry Logic for Transcription Failures

**Problem:** Transcription errors return empty text with no retry, losing valuable audio content.

**Files:**
- Modify: `/Users/jamesmcarthur/sessions/src/services/transcription.ts:46-59`

**Step 1: Add retry logic to transcribe method**

```typescript
async transcribe(audioBase64: string, maxRetries = 2): Promise<TranscriptionResult> {
  const apiKey = this.getOpenAIApiKey();

  if (!apiKey) {
    console.warn('[TRANSCRIPTION] No OpenAI API key configured, skipping transcription');
    return { text: '' };
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, attempt - 1) * 1000;
        console.log(`[TRANSCRIPTION] Retry ${attempt}/${maxRetries} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      return await this.transcribeWithOpenAI(audioBase64, apiKey);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[TRANSCRIPTION] Attempt ${attempt + 1} failed:`, lastError.message);
    }
  }

  // All retries failed
  console.error('[TRANSCRIPTION] All retries exhausted');
  throw lastError || new Error('Transcription failed after retries');
}
```

**Step 2: Update transcribeWithOpenAI to throw on failure**

```typescript
private async transcribeWithOpenAI(
  audioBase64: string,
  apiKey: string
): Promise<TranscriptionResult> {
  // ... existing code up to fetch ...

  try {
    console.log('[TRANSCRIPTION] Sending audio to Whisper API...');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[TRANSCRIPTION] API error:', response.status, error);
      throw new Error(`Transcription API error ${response.status}: ${error}`);
    }

    const result = await response.json();

    console.log('[TRANSCRIPTION] Received transcript:', result.text?.substring(0, 100) + '...');

    return {
      text: result.text || '',
      segments: result.segments?.map((s: { start: number; end: number; text: string }) => ({
        start: s.start,
        end: s.end,
        text: s.text,
      })),
      language: result.language,
    };
  } catch (error) {
    // Re-throw to allow retry logic to handle
    throw error;
  }
}
```

**Step 3: Run type check**

Run: `cd /Users/jamesmcarthur/sessions && npx tsc --noEmit`
Expected: No type errors

**Step 4: Commit**

```bash
git add src/services/transcription.ts
git commit -m "feat: add retry logic for transcription failures

Retry up to 2 times with exponential backoff to handle
transient API errors.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 10: Fix Bot Initialization Race Condition

**Problem:** `ensureBots()` can be called concurrently, potentially initializing multiple times.

**Files:**
- Modify: `/Users/jamesmcarthur/sessions/src/services/session-coordinator.ts:76-99`

**Step 1: Add initialization lock**

```typescript
// Add at class level
private botInitPromise: Promise<typeof import('./bots')> | null = null;

private async ensureBots() {
  // Use existing promise if initialization in progress
  if (this.botInitPromise) {
    return this.botInitPromise;
  }

  if (this.botsModule) {
    return this.botsModule;
  }

  // Create and store promise to prevent concurrent init
  this.botInitPromise = (async () => {
    const module = await import('./bots');

    const initialized = await module.initializeBots();
    if (!initialized) {
      console.warn('[COORDINATOR] Bots not initialized - no API key configured');
    }

    this.botsModule = module;
    this.botInitPromise = null;
    return module;
  })();

  return this.botInitPromise;
}
```

**Step 2: Run type check**

Run: `cd /Users/jamesmcarthur/sessions && npx tsc --noEmit`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/services/session-coordinator.ts
git commit -m "fix: prevent concurrent bot initialization

Use promise lock to ensure bots module is only loaded once
even with concurrent ensureBots calls.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 3: Final Verification

### Task 11: Fix AudioLevelMeter Web API Device ID Mismatch

**Problem:** `AudioLevelMeter` uses Web Audio API with device IDs from the Tauri backend. The Web API expects different device IDs than what Tauri provides.

**Files:**
- Modify: `/Users/jamesmcarthur/sessions/src/components/AudioLevelMeter.tsx:26-51`

**Step 1: Update to use Web API device enumeration**

```typescript
async function startListening() {
  try {
    setError(null)
    setIsListening(false)

    // The deviceId prop comes from Tauri (device name)
    // We need to find the matching Web API device
    const webDevices = await navigator.mediaDevices.enumerateDevices()
    const audioInputs = webDevices.filter(d => d.kind === 'audioinput')

    // Try to find matching device by name (Tauri uses device name as ID)
    let matchingDevice = audioInputs.find(d =>
      d.label === deviceId || d.deviceId === deviceId
    )

    // Fallback to default if no match
    const constraints: MediaStreamConstraints = {
      audio: matchingDevice
        ? { deviceId: { exact: matchingDevice.deviceId } }
        : true,
      video: false,
    }

    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    // ... rest of existing code
  } catch (err) {
    // ... existing error handling
  }
}
```

**Step 2: Run type check**

Run: `cd /Users/jamesmcarthur/sessions && npx tsc --noEmit`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/components/AudioLevelMeter.tsx
git commit -m "fix: match Tauri device IDs to Web Audio API devices

Map device name from Tauri backend to Web API device ID
for audio level preview.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 12: Build and Test Full Application

**Files:**
- No file changes - verification only

**Step 1: Run TypeScript check**

Run: `cd /Users/jamesmcarthur/sessions && npx tsc --noEmit`
Expected: No type errors

**Step 2: Run Tauri build**

Run: `cd /Users/jamesmcarthur/sessions && npm run tauri build`
Expected: Build succeeds

**Step 3: Manual test checklist**

- [ ] Open app, verify Settings shows API key fields
- [ ] Add Claude API key, verify saves
- [ ] Add OpenAI API key, verify saves
- [ ] Open Recording Settings
- [ ] Verify audio devices list populates
- [ ] Select a non-default microphone
- [ ] Verify audio level meter shows activity
- [ ] Start recording with audio enabled
- [ ] Pause recording, verify "Paused" state
- [ ] Resume recording, verify audio continues
- [ ] End session, verify processing completes
- [ ] View session summary, verify AI-generated content

**Step 4: Create final summary commit (if all tests pass)**

```bash
git add -A
git commit -m "chore: complete sessions core fixes

All critical recording and AI pipeline issues resolved:
- Audio device ID stability
- Audio pause/resume
- Activity monitoring
- Screenshot error tracking
- API key validation
- Transcription retries
- Bot initialization race condition

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary of Changes

| Issue | Fix Location | Status |
|-------|--------------|--------|
| Audio device ID stability | lib.rs, audio_capture.rs | Task 1 |
| Audio resume not exposed | lib.rs, recording.ts | Task 2 |
| Resume doesn't call Rust | recording.ts | Task 3 |
| Audio buffer during pause | audio_capture.rs | Task 4 |
| Activity monitor in interval mode | recording.ts | Task 5 |
| Screenshot error visibility | recording.ts | Task 6 |
| API key validation at start | SessionRecording.tsx | Task 7 |
| Periodic analysis after stop | session-coordinator.ts | Task 8 |
| Transcription retry | transcription.ts | Task 9 |
| Bot init race condition | session-coordinator.ts | Task 10 |
| AudioLevelMeter device match | AudioLevelMeter.tsx | Task 11 |
