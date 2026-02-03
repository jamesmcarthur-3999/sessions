# Session Start UX Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the session starting flow "air tight" - fully validated, transparent, and resilient with proper user feedback.

**Architecture:** Add device validation, loading states, audio level preview, test screenshot capability, and consolidate permission checks into a single clear flow. Replace silent failures with toast notifications.

**Tech Stack:** React 19, TypeScript, Tauri v2, Framer Motion

---

## Overview of Changes

The current session start flow has these issues:
1. No loading indicator during device enumeration
2. No way to verify microphone works (audio level meter)
3. No way to preview which screen will be captured
4. Redundant permission checks (3 places)
5. Silent failures when audio/screenshot capture fails
6. No device refresh capability
7. Start button disabled with no explanation

This plan addresses all issues systematically.

---

### Task 1: Add Loading State During Device Enumeration

**Files:**
- Modify: `src/components/RecordingSettings.tsx:61-67` (add loading state usage)
- Modify: `src/components/RecordingSettings.tsx:182-207` (add skeleton UI)

**Step 1: Update the loading state to show skeleton UI**

In RecordingSettings.tsx, add a skeleton loading component for device enumeration. Currently `_isLoadingDevices` is unused (prefixed with underscore).

```typescript
// At line 64, rename back to usable:
const [isLoadingDevices, setIsLoadingDevices] = useState(true)
```

**Step 2: Add skeleton loader component before the content section**

After the permission warning section (line 206), add loading skeleton:

```typescript
{/* Loading skeleton */}
{isLoadingDevices && (
  <div className="space-y-4 animate-pulse">
    <div className="h-4 w-24 bg-[var(--paper-dark)] rounded" />
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-16 bg-[var(--paper-dark)] rounded-xl" />
      ))}
    </div>
    <div className="h-4 w-20 bg-[var(--paper-dark)] rounded" />
    <div className="space-y-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-14 bg-[var(--paper-dark)] rounded-xl" />
      ))}
    </div>
  </div>
)}
```

**Step 3: Wrap capture toggles section in conditional**

Change line 208 from:
```typescript
{/* Capture toggles */}
<div className="space-y-3">
```

To:
```typescript
{/* Capture toggles */}
{!isLoadingDevices && (
<div className="space-y-3">
```

And add closing tag before footer.

**Step 4: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/components/RecordingSettings.tsx
git commit -m "$(cat <<'EOF'
feat(recording-settings): add loading skeleton during device enumeration

Show skeleton UI while devices are being enumerated to provide clear
feedback that something is loading.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add Audio Level Meter Component

**Files:**
- Create: `src/components/AudioLevelMeter.tsx`

**Step 1: Create the AudioLevelMeter component**

```typescript
/**
 * AudioLevelMeter
 *
 * Real-time visualization of microphone input level.
 * Shows if microphone is working before starting recording.
 */

import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Mic, MicOff, AlertTriangle } from 'lucide-react'

interface AudioLevelMeterProps {
  deviceId: string | null
  isActive: boolean
}

export function AudioLevelMeter({ deviceId, isActive }: AudioLevelMeterProps) {
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [isListening, setIsListening] = useState(false)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animationRef = useRef<number | null>(null)

  useEffect(() => {
    if (!isActive) {
      cleanup()
      return
    }

    async function startListening() {
      try {
        setError(null)
        setIsListening(false)

        // Get audio stream
        const constraints: MediaStreamConstraints = {
          audio: deviceId ? { deviceId: { exact: deviceId } } : true,
          video: false,
        }

        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        streamRef.current = stream

        // Create audio context and analyser
        const audioContext = new AudioContext()
        audioContextRef.current = audioContext

        const analyser = audioContext.createAnalyser()
        analyser.fftSize = 256
        analyserRef.current = analyser

        const source = audioContext.createMediaStreamSource(stream)
        source.connect(analyser)

        setIsListening(true)

        // Start level monitoring
        const dataArray = new Uint8Array(analyser.frequencyBinCount)

        function updateLevel() {
          if (!analyserRef.current) return

          analyserRef.current.getByteFrequencyData(dataArray)

          // Calculate RMS level
          let sum = 0
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i] * dataArray[i]
          }
          const rms = Math.sqrt(sum / dataArray.length)
          const normalizedLevel = Math.min(rms / 128, 1) // Normalize to 0-1

          setLevel(normalizedLevel)
          animationRef.current = requestAnimationFrame(updateLevel)
        }

        updateLevel()
      } catch (err) {
        console.error('Failed to access microphone:', err)
        setError(err instanceof Error ? err.message : 'Microphone access denied')
        setIsListening(false)
      }
    }

    startListening()

    return cleanup
  }, [isActive, deviceId])

  function cleanup() {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    analyserRef.current = null
    setLevel(0)
    setIsListening(false)
  }

  if (!isActive) return null

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--error-muted)] text-[var(--error)]">
        <MicOff className="w-4 h-4" />
        <span className="text-xs">Mic unavailable</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--paper-dark)]">
      <Mic className={`w-4 h-4 ${isListening ? 'text-[var(--success)]' : 'text-[var(--ink-muted)]'}`} />

      {/* Level bars */}
      <div className="flex items-center gap-0.5 h-4">
        {Array.from({ length: 10 }).map((_, i) => {
          const threshold = (i + 1) / 10
          const isActive = level >= threshold
          const isHigh = threshold > 0.8

          return (
            <motion.div
              key={i}
              className={`w-1 rounded-full transition-colors ${
                isActive
                  ? isHigh
                    ? 'bg-[var(--error)]'
                    : 'bg-[var(--success)]'
                  : 'bg-[var(--paper-warm)]'
              }`}
              animate={{
                height: isActive ? `${12 + i * 0.5}px` : '4px',
              }}
              transition={{ duration: 0.05 }}
            />
          )
        })}
      </div>

      {/* Status text */}
      <span className="text-xs text-[var(--ink-muted)]">
        {isListening ? (level > 0.1 ? 'Receiving audio' : 'Listening...') : 'Connecting...'}
      </span>

      {/* Clipping warning */}
      {level > 0.9 && (
        <AlertTriangle className="w-3 h-3 text-[var(--error)]" />
      )}
    </div>
  )
}
```

**Step 2: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/AudioLevelMeter.tsx
git commit -m "$(cat <<'EOF'
feat(audio): add AudioLevelMeter component for mic preview

Shows real-time audio level visualization so users can verify their
microphone is working before starting a recording.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Add Test Screenshot Capability to Rust Backend

**Files:**
- Modify: `src-tauri/src/lib.rs:102-130` (add test screenshot command)

**Step 1: Add test_capture_screenshot command**

Add this new command after the existing `capture_screenshot` command (around line 131):

```rust
/// Captures a test screenshot and returns a smaller thumbnail for preview
#[tauri::command]
fn test_capture_screenshot(screen_id: Option<String>) -> Result<String, String> {
    capture_with_retry(|| {
        let screens = Screen::all().map_err(|e| format!("Failed to get screens: {}", e))?;

        if screens.is_empty() {
            return Err("No screens found".to_string());
        }

        // Select screen by ID (index) or default to first
        let screen_idx: usize = screen_id
            .as_ref()
            .and_then(|id| id.parse().ok())
            .unwrap_or(0);

        let screen = screens.get(screen_idx).unwrap_or(&screens[0]);
        let image = screen.capture().map_err(|e| format!("Failed to capture screen: {}", e))?;

        // Resize to thumbnail (max 400px width for preview)
        let thumbnail = if image.width() > 400 {
            let scale = 400.0 / image.width() as f32;
            let new_height = (image.height() as f32 * scale) as u32;
            screenshots::image::imageops::resize(
                &image,
                400,
                new_height,
                screenshots::image::imageops::FilterType::Triangle,
            )
        } else {
            image.clone()
        };

        let mut bytes: Vec<u8> = Vec::new();
        let mut cursor = Cursor::new(&mut bytes);
        thumbnail
            .write_to(&mut cursor, ImageFormat::Png)
            .map_err(|e| format!("Failed to encode PNG: {}", e))?;

        let base64_data = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
        Ok(format!("data:image/png;base64,{}", base64_data))
    }, 3)
}
```

**Step 2: Register the command in invoke_handler**

Add `test_capture_screenshot` to the handler list at line 274:

```rust
// Screenshot
capture_screenshot,
test_capture_screenshot,
```

**Step 3: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: No errors

**Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "$(cat <<'EOF'
feat(backend): add test_capture_screenshot command for preview

Returns a resized thumbnail (max 400px) for efficient preview in the
settings modal before starting a recording.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Add Test Screenshot Function to Recording Service

**Files:**
- Modify: `src/services/recording.ts:34-36` (add test screenshot function)

**Step 1: Add testCaptureScreenshot function**

After line 36 (after `captureScreenshot` function), add:

```typescript
export async function testCaptureScreenshot(screenId?: string | null): Promise<string> {
  return invoke<string>('test_capture_screenshot', { screenId: screenId ?? null })
}
```

**Step 2: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/services/recording.ts
git commit -m "$(cat <<'EOF'
feat(recording): add testCaptureScreenshot service function

Exposes the Rust test_capture_screenshot command to the frontend for
preview functionality.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Add ScreenPreview Component

**Files:**
- Create: `src/components/ScreenPreview.tsx`

**Step 1: Create the ScreenPreview component**

```typescript
/**
 * ScreenPreview
 *
 * Shows a live preview of what will be captured from the selected screen.
 */

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Monitor, RefreshCw, Check, X, Loader2 } from 'lucide-react'
import { testCaptureScreenshot, isTauri } from '../services/recording'

interface ScreenPreviewProps {
  screenId: string | null
  screenName: string
  onClose: () => void
}

export function ScreenPreview({ screenId, screenName, onClose }: ScreenPreviewProps) {
  const [preview, setPreview] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const capturePreview = async () => {
    if (!isTauri()) {
      setError('Preview only available in desktop app')
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const screenshot = await testCaptureScreenshot(screenId)
      setPreview(screenshot)
    } catch (err) {
      console.error('Failed to capture preview:', err)
      setError(err instanceof Error ? err.message : 'Failed to capture screen')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    capturePreview()
  }, [screenId])

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="mt-3 rounded-xl border border-[var(--border-medium)] overflow-hidden bg-[var(--paper-dark)]"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-[var(--ink-muted)]" />
          <span className="text-sm text-[var(--ink)]">{screenName} Preview</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={capturePreview}
            disabled={isLoading}
            className="p-1.5 rounded-lg hover:bg-[var(--paper-warm)] transition-colors disabled:opacity-50"
            title="Refresh preview"
          >
            <RefreshCw className={`w-4 h-4 text-[var(--ink-muted)] ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--paper-warm)] transition-colors"
            title="Close preview"
          >
            <X className="w-4 h-4 text-[var(--ink-muted)]" />
          </button>
        </div>
      </div>

      {/* Preview area */}
      <div className="relative aspect-video bg-black/50 flex items-center justify-center">
        {isLoading && (
          <div className="flex flex-col items-center gap-2 text-[var(--ink-muted)]">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-xs">Capturing preview...</span>
          </div>
        )}

        {error && !isLoading && (
          <div className="flex flex-col items-center gap-2 text-[var(--error)] px-4 text-center">
            <X className="w-6 h-6" />
            <span className="text-xs">{error}</span>
          </div>
        )}

        {preview && !isLoading && !error && (
          <>
            <img
              src={preview}
              alt="Screen preview"
              className="max-w-full max-h-full object-contain"
            />
            <div className="absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--success)]/90 text-white text-xs">
              <Check className="w-3 h-3" />
              <span>Ready to capture</span>
            </div>
          </>
        )}
      </div>
    </motion.div>
  )
}
```

**Step 2: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/ScreenPreview.tsx
git commit -m "$(cat <<'EOF'
feat(screen-preview): add ScreenPreview component for capture validation

Shows a live thumbnail of what will be captured so users can verify
they've selected the correct screen before recording.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Integrate Audio Level Meter into RecordingSettings

**Files:**
- Modify: `src/components/RecordingSettings.tsx:1-16` (add import)
- Modify: `src/components/RecordingSettings.tsx:284-326` (add meter after mic dropdown)

**Step 1: Add import at the top of the file**

After line 16 (after the lucide imports), add:

```typescript
import { AudioLevelMeter } from './AudioLevelMeter'
```

**Step 2: Add AudioLevelMeter after the mic dropdown**

After line 326 (after the closing `</div>` of the mic selector), add:

```typescript
                {/* Audio level preview */}
                {config.selectedMicrophone && (
                  <AudioLevelMeter
                    deviceId={config.selectedMicrophone}
                    isActive={config.enableAudio}
                  />
                )}
```

**Step 3: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/RecordingSettings.tsx
git commit -m "$(cat <<'EOF'
feat(recording-settings): integrate AudioLevelMeter for mic preview

Users can now see a real-time audio level meter to verify their
microphone is working before starting a recording.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Integrate ScreenPreview into RecordingSettings

**Files:**
- Modify: `src/components/RecordingSettings.tsx:1-17` (add import)
- Modify: `src/components/RecordingSettings.tsx:61-68` (add preview state)
- Modify: `src/components/RecordingSettings.tsx:328-377` (add preview button and component)

**Step 1: Add import after AudioLevelMeter import**

```typescript
import { ScreenPreview } from './ScreenPreview'
```

**Step 2: Add state for showing preview**

After line 67 (after showIntervalDropdown state), add:

```typescript
const [showScreenPreview, setShowScreenPreview] = useState(false)
```

**Step 3: Add preview button and component after screen selector**

After the screen selector (after line 377 where `</AnimatePresence>` closes), add:

```typescript
                {/* Preview button */}
                {selectedScreen && (
                  <button
                    onClick={() => setShowScreenPreview(!showScreenPreview)}
                    className="w-full flex items-center justify-center gap-2 p-2 rounded-lg text-sm text-[var(--accent)] hover:bg-[var(--accent-muted)] transition-colors"
                  >
                    <Monitor className="w-4 h-4" />
                    <span>{showScreenPreview ? 'Hide Preview' : 'Preview Capture'}</span>
                  </button>
                )}

                {/* Screen preview */}
                <AnimatePresence>
                  {showScreenPreview && selectedScreen && (
                    <ScreenPreview
                      screenId={config.selectedScreen}
                      screenName={selectedScreen.name}
                      onClose={() => setShowScreenPreview(false)}
                    />
                  )}
                </AnimatePresence>
```

**Step 4: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/components/RecordingSettings.tsx
git commit -m "$(cat <<'EOF'
feat(recording-settings): add screen capture preview functionality

Users can now preview which screen will be captured before starting
the recording, eliminating guesswork with multiple displays.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Add Device Refresh Button

**Files:**
- Modify: `src/components/RecordingSettings.tsx:61-68` (add refresh function)
- Modify: `src/components/RecordingSettings.tsx:163-179` (add refresh button to header)

**Step 1: Extract device loading into a reusable function**

At line 69 (before the useEffect), add:

```typescript
const loadDevices = async () => {
  setIsLoadingDevices(true)
  setHasPermission(null)

  if (isTauri()) {
    try {
      const permitted = await checkScreenRecordingPermission()
      setHasPermission(permitted)

      const [mics, displays] = await Promise.all([
        getAudioDevices(),
        getScreens(),
      ])

      setAudioDevices(mics)
      setScreens(displays)

      // Auto-select defaults only if not already selected
      if (!config.selectedMicrophone) {
        const defaultMic = mics.find(d => d.isDefault)
        if (defaultMic) {
          onConfigChange({ ...config, selectedMicrophone: defaultMic.id })
        }
      }

      if (!config.selectedScreen) {
        const primaryScreen = displays.find(s => s.isPrimary)
        if (primaryScreen) {
          onConfigChange({ ...config, selectedScreen: primaryScreen.id })
        }
      }
    } catch (e) {
      console.error('Failed to load devices:', e)
    }
  } else {
    // Browser mode - mock devices
    setAudioDevices([
      { id: 'default', name: 'Default Microphone', isDefault: true },
    ])
    setScreens([
      { id: '0', name: 'Primary Display', width: 1920, height: 1080, x: 0, y: 0, isPrimary: true },
    ])
    setHasPermission(true)
  }

  setIsLoadingDevices(false)
}
```

**Step 2: Update useEffect to use the extracted function**

Replace the existing useEffect (lines 70-123) with:

```typescript
useEffect(() => {
  if (!isOpen) return
  loadDevices()
}, [isOpen])
```

**Step 3: Add RefreshCw import**

Update the lucide imports to include RefreshCw:

```typescript
import {
  X,
  Mic,
  Monitor,
  Camera,
  ChevronDown,
  Check,
  AlertCircle,
  Settings2,
  Zap,
  Sun,
  Moon,
  Sparkles,
  RefreshCw,
} from 'lucide-react'
```

**Step 4: Add refresh button to header**

After line 177 (the X close button), add a refresh button:

```typescript
            <div className="flex items-center gap-2">
              <button
                onClick={loadDevices}
                disabled={isLoadingDevices}
                className="p-2 rounded-lg hover:bg-[var(--paper-warm)] transition-colors disabled:opacity-50"
                title="Refresh devices"
              >
                <RefreshCw className={`w-4 h-4 text-[var(--ink-muted)] ${isLoadingDevices ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-[var(--paper-warm)] transition-colors"
              >
                <X className="w-5 h-5 text-[var(--ink-muted)]" />
              </button>
            </div>
```

And remove the old standalone close button.

**Step 5: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/components/RecordingSettings.tsx
git commit -m "$(cat <<'EOF'
feat(recording-settings): add device refresh button

Users can now refresh the device list if they plug/unplug a microphone
or display while the settings modal is open.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Consolidate Permission Check - Remove Redundant Checks

**Files:**
- Modify: `src/components/SessionRecording.tsx:86-98` (remove permission check)
- Modify: `src/services/recording.ts:189-195` (remove permission check)

**Step 1: Update SessionRecording to trust RecordingSettings permission check**

Since RecordingSettings already checks and gates the Start button on permission, we can trust that permission is granted. Update SessionRecording.tsx lines 86-98.

Replace:
```typescript
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
```

With:
```typescript
      if (isTauri()) {
        try {
          // Permission already validated in RecordingSettings
          // Just verify it's still valid (edge case: user revoked mid-transition)
          const permitted = await checkScreenRecordingPermission()
          if (!permitted) {
            setPermissionError('Screen recording permission was revoked. Please grant permission again.')
            setHasPermission(false)
            return
          }
          setHasPermission(true)
```

**Step 2: Update recording.ts to not request permission**

The recording service should only verify, not request. Update lines 189-195.

Replace:
```typescript
      const hasPermission = await checkScreenRecordingPermission()
      if (!hasPermission) {
        await requestScreenRecordingPermission()
      }
```

With:
```typescript
      // Permission should be granted before calling startRecording
      // Just verify it's still valid
      const hasPermission = await checkScreenRecordingPermission()
      if (!hasPermission) {
        throw new Error('Screen recording permission not granted')
      }
```

**Step 3: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/SessionRecording.tsx src/services/recording.ts
git commit -m "$(cat <<'EOF'
refactor(permissions): consolidate permission checks to RecordingSettings

Permission is now checked once in RecordingSettings. SessionRecording
and recording service only verify permission hasn't been revoked.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Add Recording Start Error Toasts

**Files:**
- Modify: `src/services/recording.ts:166-170` (add error tracking)
- Modify: `src/components/SessionRecording.tsx:99-118` (add toast imports and error handling)

**Step 1: Update recording.ts to expose start errors**

Add error tracking to SessionRecordingController. After line 154, add:

```typescript
export interface RecordingStartResult {
  success: boolean
  screenshotsEnabled: boolean
  audioEnabled: boolean
  videoEnabled: boolean
  errors: string[]
}
```

**Step 2: Modify startRecording to return result**

Change the signature of `startRecording` from:
```typescript
async startRecording(sessionId: string, options: Partial<RecordingOptions> = {}): Promise<void> {
```

To:
```typescript
async startRecording(sessionId: string, options: Partial<RecordingOptions> = {}): Promise<RecordingStartResult> {
```

And at line 250, replace:
```typescript
    console.log('📹 Session recording started:', sessionId, mergedOptions)
```

With:
```typescript
    const errors: string[] = []
    let audioStarted = false
    let videoStarted = false
    let screenshotsStarted = false
```

Then wrap each subsystem start in try-catch that captures errors. The full modification is substantial, so we'll track errors and return a result object.

At the end of the function (before the closing brace), add:

```typescript
    console.log('📹 Session recording started:', sessionId, mergedOptions)

    return {
      success: errors.length === 0,
      screenshotsEnabled: screenshotsStarted,
      audioEnabled: audioStarted,
      videoEnabled: videoStarted,
      errors,
    }
```

**Step 3: Update SessionRecording to show toast on partial failures**

In SessionRecording.tsx, after the startRecording call (line 101), add error handling:

```typescript
          // Start recording with config options
          const result = await sessionRecorder.startRecording(sessionIdRef.current, recordingOptions)

          // Show warnings for partial failures
          if (result.errors.length > 0) {
            for (const error of result.errors) {
              showToast(error, 'error', 5000)
            }
          }
```

**Step 4: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/services/recording.ts src/components/SessionRecording.tsx
git commit -m "$(cat <<'EOF'
feat(recording): add error toasts for subsystem failures

When audio, video, or screenshot capture fails to start, users now see
a toast notification instead of silent failure.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Add Start Button Disabled Explanation

**Files:**
- Modify: `src/components/RecordingSettings.tsx:544-561` (add tooltip/explanation)

**Step 1: Add explanation text when button is disabled**

Update the footer section (lines 544-561) to show why button is disabled:

```typescript
          {/* Footer */}
          <div className="px-6 py-5 border-t border-[var(--border-subtle)]">
            {/* Permission status message */}
            {hasPermission === false && (
              <p className="text-xs text-[var(--error)] mb-3 text-center">
                Grant screen recording permission above to start
              </p>
            )}
            {hasPermission === null && isLoadingDevices && (
              <p className="text-xs text-[var(--ink-muted)] mb-3 text-center">
                Checking permissions...
              </p>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={onClose}
                className="px-5 py-2.5 rounded-lg border border-[var(--border-medium)] text-[var(--ink)] hover:bg-[var(--paper-warm)] transition-colors text-sm"
              >
                Cancel
              </button>
              <motion.button
                onClick={onStartRecording}
                whileHover={{ scale: hasPermission !== false ? 1.02 : 1 }}
                whileTap={{ scale: hasPermission !== false ? 0.98 : 1 }}
                disabled={hasPermission === false || isLoadingDevices}
                className="px-5 py-2.5 rounded-lg bg-[var(--session-recording)] text-white font-medium hover:bg-[var(--session-recording)]/80 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow-[var(--shadow-md)]"
              >
                {isLoadingDevices ? 'Loading...' : 'Start Recording'}
              </motion.button>
            </div>
          </div>
```

**Step 2: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/RecordingSettings.tsx
git commit -m "$(cat <<'EOF'
feat(recording-settings): add explanation when start button is disabled

Users now see clear messaging about why they can't start recording
(permission needed or still loading).

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Fix Type-Safe Recording Config Passing

**Files:**
- Modify: `src/types/index.ts` (add RecordingConfig to Session type)
- Modify: `src/components/Home.tsx:80-88` (remove type casting)
- Modify: `src/components/SessionRecording.tsx:57` (remove type casting)

**Step 1: Update Session type in types/index.ts**

Add optional recordingConfig to Session interface:

```typescript
import type { RecordingConfig } from '../components/RecordingSettings'

export interface Session {
  id: string
  type: 'session' | 'capture'
  title: string
  createdAt: string
  duration?: number
  captureText?: string
  summary?: Summary
  recordingConfig?: RecordingConfig
}
```

**Step 2: Update Home.tsx to remove type cast**

Change lines 80-88 from:
```typescript
    const session: Session = {
      id: generateId(),
      type: 'session',
      title: 'New Session',
      createdAt: new Date().toISOString(),
    }
    // Store recording config in session for use by SessionRecording
    ;(session as any).recordingConfig = recordingConfig
```

To:
```typescript
    const session: Session = {
      id: generateId(),
      type: 'session',
      title: 'New Session',
      createdAt: new Date().toISOString(),
      recordingConfig,
    }
```

**Step 3: Update SessionRecording.tsx to use proper typing**

Change line 57 from:
```typescript
  const recordingConfig: RecordingConfig | undefined = (state.activeSession as any)?.recordingConfig
```

To:
```typescript
  const recordingConfig = state.activeSession?.recordingConfig
```

**Step 4: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/types/index.ts src/components/Home.tsx src/components/SessionRecording.tsx
git commit -m "$(cat <<'EOF'
refactor(types): add type-safe recordingConfig to Session

Removed unsafe type casting by properly adding recordingConfig to the
Session interface.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Final Verification and Build Test

**Step 1: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Run full build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Run Tauri check (if Rust toolchain available)**

Run: `cd src-tauri && cargo check`
Expected: No errors

**Step 4: Commit any final fixes if needed**

If there are issues, fix them and commit.

---

## Summary of Changes

After completing this plan, the session start flow will have:

1. **Loading skeleton** during device enumeration
2. **Audio level meter** to verify microphone works
3. **Screen preview** to verify correct display selected
4. **Device refresh button** to update device list
5. **Consolidated permission check** (single location)
6. **Error toasts** for subsystem failures
7. **Disabled button explanation** showing why user can't start
8. **Type-safe config passing** (no more `as any` casts)

The user experience is now:
- Transparent: Users see loading states and progress
- Validatable: Users can test audio/screen before committing
- Recoverable: Clear error messages with actions
- Robust: Single permission checkpoint, proper error handling
