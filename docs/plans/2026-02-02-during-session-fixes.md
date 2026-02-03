# During Session Experience Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all broken functionality during active recording sessions - make audio levels real, pause actually pause everything, surface errors to users, and fix capture flash timing.

**Architecture:** Add real-time audio level emission from Rust, propagate pause state to coordinator, add error event system, and connect capture events directly to UI.

**Tech Stack:** React 19, TypeScript, Tauri v2 (Rust), Framer Motion

---

## Overview of Issues to Fix

| Priority | Issue | Root Cause |
|----------|-------|------------|
| 🔴 High | Audio level is fake | `_setAudioLevel` never called, no Rust emission |
| 🔴 High | Silent failures | No error events emitted to UI |
| 🔴 High | Pause doesn't pause AI | Coordinator ignores pause state |
| 🟡 Medium | Capture flash delayed | Triggers on AI completion, not capture |
| 🟡 Medium | OpenAI key not shown | Settings only shows Claude key |
| 🟡 Medium | No transcription feedback | Silent empty returns |

---

### Task 1: Add Real-Time Audio Level Emission from Rust

**Files:**
- Modify: `src-tauri/src/audio_capture.rs` (add level emission)

**Step 1: Add audio level event emission in the stream callback**

In `audio_capture.rs`, find the `build_stream_f32` function (around line 178). Inside the stream callback, add level calculation and emission.

Add this struct near the top of the file (after line 14):

```rust
#[derive(Clone, serde::Serialize)]
struct AudioLevelEvent {
    level: f32,
}
```

Then modify the stream callback in `build_stream_f32` to emit levels. After processing samples (around line 212), add:

```rust
// Calculate RMS level for visualization (every ~100ms worth of samples)
static LEVEL_COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
let sample_count = LEVEL_COUNTER.fetch_add(data.len() as u32, std::sync::atomic::Ordering::Relaxed);

// Emit level every ~4800 samples (100ms at 48kHz)
if sample_count % 4800 < data.len() as u32 {
    let sum: f32 = data.iter().map(|&s| s * s).sum();
    let rms = (sum / data.len() as f32).sqrt();
    let normalized_level = (rms * 3.0).min(1.0); // Scale and clamp to 0-1

    if let Some(handle) = app_handle_for_level.as_ref() {
        let _ = handle.emit("audio-level", AudioLevelEvent { level: normalized_level });
    }
}
```

**Note:** This requires passing the app_handle into the stream builder. Update the function signature and pass it through.

**Step 2: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: No errors

**Step 3: Commit**

```bash
git add src-tauri/src/audio_capture.rs
git commit -m "$(cat <<'EOF'
feat(audio): emit real-time audio level events from Rust

Calculates RMS audio level every ~100ms and emits to frontend for
visualization. Level is normalized to 0-1 range.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Listen for Audio Level Events in SessionRecording

**Files:**
- Modify: `src/components/SessionRecording.tsx` (connect audio level)

**Step 1: Fix the audioLevel state setter**

Change line 45 from:
```typescript
const [audioLevel, _setAudioLevel] = useState(0)
```

To:
```typescript
const [audioLevel, setAudioLevel] = useState(0)
```

**Step 2: Add audio level event listener**

After the existing `useEffect` that listens for `activity-detected` (around line 170), add a new effect:

```typescript
// Listen for real-time audio level events from Rust
useEffect(() => {
  if (!isTauri() || !recordingConfig?.enableAudio) return

  let unlisten: (() => void) | null = null

  const setupListener = async () => {
    const { listen } = await import('@tauri-apps/api/event')
    unlisten = await listen<{ level: number }>('audio-level', (event) => {
      if (!isPaused) {
        setAudioLevel(event.payload.level)
      }
    })
  }

  setupListener()

  return () => {
    unlisten?.()
    setAudioLevel(0)
  }
}, [recordingConfig?.enableAudio, isPaused])
```

**Step 3: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/SessionRecording.tsx
git commit -m "$(cat <<'EOF'
feat(recording): connect real-time audio level from Rust to UI

Listen for audio-level events and update state for visualization.
Level updates pause when recording is paused.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Add Pause Support to Session Coordinator

**Files:**
- Modify: `src/services/session-coordinator.ts` (add pause mechanism)

**Step 1: Add pause state tracking**

After line 58 (after activityTracking map), add:

```typescript
// Pause state for sessions
private pausedSessions = new Set<string>();
```

**Step 2: Add pause/resume methods**

After the `stopSession` method (around line 136), add:

```typescript
/**
 * Pause AI analysis for a session
 */
pauseSession(sessionId: string): void {
  this.pausedSessions.add(sessionId);
  console.log('[COORDINATOR] Session paused:', sessionId);
}

/**
 * Resume AI analysis for a session
 */
resumeSession(sessionId: string): void {
  this.pausedSessions.delete(sessionId);
  console.log('[COORDINATOR] Session resumed:', sessionId);
}

/**
 * Check if session is paused
 */
isSessionPaused(sessionId: string): boolean {
  return this.pausedSessions.has(sessionId);
}
```

**Step 3: Guard analysis operations with pause check**

In `processScreenshot` (around line 141), after the `try {` line, add:

```typescript
// Skip analysis if session is paused
if (this.pausedSessions.has(sessionId)) {
  console.log('[COORDINATOR] Skipping screenshot analysis - session paused');
  return;
}
```

In `processTranscript` (around line 200), add the same check:

```typescript
async processTranscript(sessionId: string, _transcript: string): Promise<void> {
  if (this.pausedSessions.has(sessionId)) {
    console.log('[COORDINATOR] Skipping transcript processing - session paused');
    return;
  }
  // Transcripts trigger summary updates more frequently
  await this.updateSummary(sessionId);
}
```

In `runPeriodicAnalysis` (around line 377), add the same check at the start:

```typescript
private async runPeriodicAnalysis(sessionId: string): Promise<void> {
  if (this.pausedSessions.has(sessionId)) {
    return; // Skip periodic analysis when paused
  }
  // ... rest of function
}
```

**Step 4: Clean up pause state on session stop**

In `stopSession` (around line 128), add cleanup:

```typescript
async stopSession(sessionId: string): Promise<void> {
  const session = this.activeSessions.get(sessionId);
  if (session?.intervalId) {
    clearInterval(session.intervalId);
  }
  this.activeSessions.delete(sessionId);
  this.activityTracking.delete(sessionId);
  this.pausedSessions.delete(sessionId); // Clean up pause state
  console.log('Session coordinator stopped for ' + sessionId);
}
```

**Step 5: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/services/session-coordinator.ts
git commit -m "$(cat <<'EOF'
feat(coordinator): add pause/resume support for AI analysis

When a session is paused, skip screenshot analysis, transcript
processing, and periodic analysis to save API calls and respect
user intent.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Connect Pause/Resume to Coordinator in SessionRecording

**Files:**
- Modify: `src/components/SessionRecording.tsx` (call coordinator pause/resume)

**Step 1: Update handlePauseResume to notify coordinator**

Find the `handlePauseResume` function (around line 172). Update it:

```typescript
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
```

**Step 2: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/SessionRecording.tsx
git commit -m "$(cat <<'EOF'
feat(recording): pause/resume AI analysis with recording

When user pauses recording, also pause the session coordinator's
AI analysis. Resume both together.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Add Error Event System to Coordinator

**Files:**
- Modify: `src/services/session-coordinator.ts` (add error emission for user-facing failures)

**Step 1: Update the error event to include severity**

The coordinator already has an 'error' event type. Let's make sure it's emitted for user-facing errors.

In `processScreenshot`, update the catch block (around line 188-194):

```typescript
} catch (error) {
  console.error('Screenshot processing error:', error);
  this.emitter.emit('error', {
    sessionId,
    error: error instanceof Error ? error.message : 'Screenshot analysis failed',
  });
}
```

**Step 2: Add error emission for transcription failures**

In `processAudioChunk` (around line 244-246), update the catch block:

```typescript
} catch (error) {
  console.error('[COORDINATOR] Transcription failed:', error);
  this.emitter.emit('error', {
    sessionId,
    error: 'Audio transcription failed. Check your OpenAI API key in Settings.',
  });
}
```

**Step 3: Add error emission for summary failures**

In `updateSummary` (around line 418-420), update the catch block:

```typescript
} catch (error) {
  console.error('Summary update error:', error);
  this.emitter.emit('error', {
    sessionId,
    error: 'AI summary update failed. Check your Claude API key in Settings.',
  });
}
```

**Step 4: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/services/session-coordinator.ts
git commit -m "$(cat <<'EOF'
feat(coordinator): emit user-facing error events

Emit descriptive error events for transcription, screenshot analysis,
and summary failures so UI can notify the user.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Show Error Toasts in SessionRecording

**Files:**
- Modify: `src/components/SessionRecording.tsx` (listen for errors)

**Step 1: Add error event listener**

After the audio level listener effect (Task 2), add:

```typescript
// Listen for coordinator error events
useEffect(() => {
  const unsubError = sessionCoordinator.on('error', ({ error }) => {
    showToast(error, 'error', 5000)
  })

  return () => {
    unsubError()
  }
}, [showToast])
```

**Step 2: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/SessionRecording.tsx
git commit -m "$(cat <<'EOF'
feat(recording): show error toasts for AI/transcription failures

Listen for coordinator error events and display toast notifications
so users know when things fail.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Fix Capture Flash Timing - Emit Directly from Smart Capture

**Files:**
- Modify: `src/services/smart-capture.ts` (emit capture event)
- Modify: `src/components/SessionRecording.tsx` (listen for capture event)

**Step 1: Add capture event emission in smart-capture**

In `smart-capture.ts`, add an EventEmitter. After the imports (around line 10), add:

```typescript
import { EventEmitter } from './event-emitter';

type SmartCaptureEvents = {
  'capture': { sessionId: string; trigger: string };
};
```

Add an emitter to the class (after line 24):

```typescript
private emitter = new EventEmitter<SmartCaptureEvents>();

/**
 * Subscribe to smart capture events
 */
on<K extends keyof SmartCaptureEvents>(
  event: K,
  callback: (data: SmartCaptureEvents[K]) => void
): () => void {
  return this.emitter.on(event, callback);
}
```

In `captureNow` method (around line 200), emit the event immediately after capture succeeds:

```typescript
private async captureNow(trigger: string): Promise<void> {
  if (!this.isRunning || !this.sessionId) return;

  try {
    const screenshot = await captureScreenshot(this.screenId);
    this.lastCaptureTime = Date.now();

    // Emit capture event immediately for UI feedback
    this.emitter.emit('capture', { sessionId: this.sessionId, trigger });

    // Save to database (async, don't block)
    // ... rest of function
```

**Step 2: Update SessionRecording to listen for capture event**

Replace the existing activity-detected listener (lines 165-174) with:

```typescript
// Listen for capture events (immediate) and activity events (after analysis)
useEffect(() => {
  // Immediate capture flash from smart capture
  const unsubCapture = smartCapture.on('capture', () => {
    setCaptureFlash(true)
    setTimeout(() => setCaptureFlash(false), 100)
  })

  // Can also flash on activity detection if we want double feedback
  // const unsubActivity = sessionCoordinator.on('activity-detected', () => { ... })

  return () => {
    unsubCapture()
  }
}, [])
```

**Step 3: Add smartCapture import**

At the top of SessionRecording.tsx, add:

```typescript
import { smartCapture } from '../services/smart-capture'
```

**Step 4: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/services/smart-capture.ts src/components/SessionRecording.tsx
git commit -m "$(cat <<'EOF'
fix(capture): trigger flash immediately on screenshot, not after AI

Emit capture event directly from smart-capture so UI can show flash
animation immediately instead of waiting for AI analysis to complete.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Add OpenAI API Key Field to Settings

**Files:**
- Modify: `src/components/Settings.tsx` (add OpenAI key field)

**Step 1: Read the current Settings component**

First, read the file to understand its structure.

**Step 2: Add OpenAI key state and field**

Add a second API key field for OpenAI. The existing pattern for Claude key can be duplicated.

After the Claude key input section, add:

```typescript
{/* OpenAI API Key */}
<div className="space-y-3">
  <div className="flex items-center justify-between">
    <label className="label-section">OpenAI API Key (for transcription)</label>
    {openaiApiKey && (
      <span className="text-xs text-[var(--success)] flex items-center gap-1">
        <Check className="w-3 h-3" />
        Configured
      </span>
    )}
  </div>
  <div className="relative">
    <input
      type={showOpenaiKey ? 'text' : 'password'}
      value={openaiApiKey}
      onChange={(e) => setOpenaiApiKey(e.target.value)}
      placeholder="sk-..."
      className="w-full px-4 py-3 rounded-xl border border-[var(--border-medium)] bg-[var(--paper)] text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent pr-12"
    />
    <button
      type="button"
      onClick={() => setShowOpenaiKey(!showOpenaiKey)}
      className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg hover:bg-[var(--paper-warm)] transition-colors"
    >
      {showOpenaiKey ? (
        <EyeOff className="w-4 h-4 text-[var(--ink-muted)]" />
      ) : (
        <Eye className="w-4 h-4 text-[var(--ink-muted)]" />
      )}
    </button>
  </div>
  <p className="text-xs text-[var(--ink-muted)]">
    Required for audio transcription. Get your key from{' '}
    <a
      href="https://platform.openai.com/api-keys"
      target="_blank"
      rel="noopener noreferrer"
      className="text-[var(--accent)] hover:underline"
    >
      OpenAI Dashboard
    </a>
  </p>
</div>
```

**Step 3: Add state for OpenAI key**

Add these state variables:

```typescript
const [openaiApiKey, setOpenaiApiKey] = useState('')
const [showOpenaiKey, setShowOpenaiKey] = useState(false)
```

**Step 4: Load/save OpenAI key**

In the useEffect that loads the Claude key, also load OpenAI:

```typescript
const savedOpenaiKey = localStorage.getItem('sessions_openai_api_key') || ''
setOpenaiApiKey(savedOpenaiKey)
```

In the save handler, also save OpenAI:

```typescript
if (openaiApiKey) {
  localStorage.setItem('sessions_openai_api_key', openaiApiKey)
} else {
  localStorage.removeItem('sessions_openai_api_key')
}
```

**Step 5: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "$(cat <<'EOF'
feat(settings): add OpenAI API key field for transcription

Users can now configure their OpenAI API key for Whisper transcription.
Clear guidance provided about what each key enables.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Add Transcription Status Indicator

**Files:**
- Modify: `src/components/SessionRecording.tsx` (show transcription status)

**Step 1: Add transcription status state**

After the audioLevel state, add:

```typescript
const [transcriptionStatus, setTranscriptionStatus] = useState<'idle' | 'transcribing' | 'success' | 'error'>('idle')
```

**Step 2: Listen for transcription events**

We need to emit events from the transcription service. For now, we can track based on coordinator events.

Update the audio chunk processing to include status. In the coordinator error listener, detect transcription errors:

```typescript
// Listen for coordinator error events
useEffect(() => {
  const unsubError = sessionCoordinator.on('error', ({ error }) => {
    showToast(error, 'error', 5000)

    // Track transcription errors
    if (error.includes('transcription')) {
      setTranscriptionStatus('error')
    }
  })

  return () => {
    unsubError()
  }
}, [showToast])
```

**Step 3: Show transcription status in capture stats**

Update the Audio indicator in the capture stats section (around line 509-513):

```typescript
{recordingConfig?.enableAudio && (
  <div className="flex items-center gap-2">
    <Mic className={`w-4 h-4 ${
      transcriptionStatus === 'error'
        ? 'text-[var(--error)]'
        : audioLevel > 0.1
          ? 'text-[var(--success)]'
          : 'text-[var(--ink-muted)]'
    }`} />
    <span>{transcriptionStatus === 'error' ? 'Transcription failed' : 'Audio'}</span>
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
```

**Step 4: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/components/SessionRecording.tsx
git commit -m "$(cat <<'EOF'
feat(recording): add transcription status and audio level visualization

Show real-time audio level bars and indicate when transcription fails.
Users can now see their mic is working and know if transcription broke.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Add API Key Warning to Recording Settings

**Files:**
- Modify: `src/components/RecordingSettings.tsx` (warn about missing keys)

**Step 1: Check for API keys**

Add imports and state:

```typescript
import { hasApiKey } from '../services/bots'
```

In the component, check for keys:

```typescript
const hasClaudeKey = hasApiKey()
const hasOpenaiKey = !!localStorage.getItem('sessions_openai_api_key')
```

**Step 2: Add warning banner after permission warning**

After the permission warning section (around line 206), add:

```typescript
{/* API key warnings */}
{!hasClaudeKey && (
  <motion.div
    initial={{ opacity: 0, y: -10 }}
    animate={{ opacity: 1, y: 0 }}
    className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200"
  >
    <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
    <div className="flex-1">
      <p className="text-sm font-medium text-amber-800">
        AI features require Claude API key
      </p>
      <p className="text-xs text-amber-600 mt-1">
        Without it, you'll get basic recording but no intelligent summaries or insights.
      </p>
    </div>
  </motion.div>
)}

{config.enableAudio && !hasOpenaiKey && (
  <motion.div
    initial={{ opacity: 0, y: -10 }}
    animate={{ opacity: 1, y: 0 }}
    className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200"
  >
    <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
    <div className="flex-1">
      <p className="text-sm font-medium text-amber-800">
        Audio transcription requires OpenAI API key
      </p>
      <p className="text-xs text-amber-600 mt-1">
        Audio will be recorded but not transcribed. Add your key in Settings.
      </p>
    </div>
  </motion.div>
)}
```

**Step 3: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/RecordingSettings.tsx
git commit -m "$(cat <<'EOF'
feat(recording-settings): warn about missing API keys

Show clear warnings when Claude or OpenAI keys are missing, explaining
what features won't work without them.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Final Verification and Build Test

**Step 1: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Run full build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Run Tauri check**

Run: `cd src-tauri && cargo check`
Expected: No errors (warnings OK)

**Step 4: Commit any final fixes if needed**

---

## Summary of Fixes

After completing this plan:

| Issue | Fix |
|-------|-----|
| Fake audio level | Real-time Rust emission → UI state |
| Pause doesn't pause AI | Coordinator pause/resume methods |
| Silent failures | Error event emission + toasts |
| Capture flash delayed | Direct emit from smart-capture |
| OpenAI key hidden | Added to Settings |
| No transcription feedback | Status indicator + error states |
| No API key warnings | Banner in RecordingSettings |

**User Experience After Fixes:**
- Audio meter shows real input levels
- Peripheral glow responds to actual audio
- Pause truly pauses everything
- Errors show as toast notifications
- Clear guidance on required API keys
- Capture flash is instant
- Transcription status visible
