# End Session & Summary View Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix data integrity issues, improve error handling, add missing progress feedback, and complete the summary view UX for a polished end-to-end experience.

**Architecture:** Add confirmation dialog, granular progress tracking, atomic save with rollback, proper chat context loading, and database cleanup on delete.

**Tech Stack:** React 19, TypeScript, Tauri v2, Framer Motion, SQLite

---

## Overview of Issues to Fix

| Priority | Issue | Root Cause |
|----------|-------|------------|
| 🔴 P0 | Non-atomic session save | No transaction/rollback |
| 🔴 P0 | Chat missing context | Screenshots/transcripts hardcoded empty |
| 🔴 P0 | Screenshots reverse order | DB query uses DESC |
| 🔴 P0 | Database not cleaned on delete | Only localStorage deleted |
| 🔴 P0 | Recording stop errors swallowed | catch logs but doesn't throw |
| 🟡 P1 | No end confirmation | Accidental clicks lose work |
| 🟡 P1 | No progress feedback | Generic "Processing" message |
| 🟡 P1 | Broken error recovery | Returns to recording but services stopped |
| 🟡 P1 | Can't skip typewriter | Must wait for animation |
| 🟡 P1 | "+N more" does nothing | Click handler missing |
| 🟡 P2 | Task state not in database | Only localStorage |
| 🟡 P2 | No title editing in SummaryView | Read-only |

---

### Task 1: Fix Screenshot Order in Database Query

**Files:**
- Modify: `src/services/database.ts`

**Step 1: Change screenshot query to ascending order**

Find the `getScreenshots` function and change the ORDER BY clause.

Current (around line 231):
```typescript
export async function getScreenshots(sessionId: string, limit?: number): Promise<DbScreenshot[]> {
  const db = await getDb()
  const query = limit
    ? `SELECT * FROM screenshots WHERE session_id = $1 ORDER BY captured_at DESC LIMIT $2`
    : `SELECT * FROM screenshots WHERE session_id = $1 ORDER BY captured_at DESC`
```

Change to:
```typescript
export async function getScreenshots(sessionId: string, limit?: number): Promise<DbScreenshot[]> {
  const db = await getDb()
  const query = limit
    ? `SELECT * FROM screenshots WHERE session_id = $1 ORDER BY captured_at ASC LIMIT $2`
    : `SELECT * FROM screenshots WHERE session_id = $1 ORDER BY captured_at ASC`
```

**Step 2: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/services/database.ts
git commit -m "$(cat <<'EOF'
fix(database): return screenshots in chronological order

Changed ORDER BY from DESC to ASC so screenshots appear oldest-first,
matching the timeline order expected by AI summary generation.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Fix Chat Context - Load Screenshots and Transcripts

**Files:**
- Modify: `src/components/SummaryView.tsx`

**Step 1: Update handleSendMessage to include real context**

Find `handleSendMessage` (around line 140). Update the context building:

Replace:
```typescript
const context: SessionContext = {
  sessionId: session.id,
  rollingSummary: session.summary?.text || '',
  recentScreenshots: [],
  recentTranscripts: [],
  recentInsights: session.summary?.notes.map(n => n.content) || [],
  durationSeconds: session.duration || 0,
  analysisMode: 'ambient',
}
```

With:
```typescript
const context: SessionContext = {
  sessionId: session.id,
  rollingSummary: session.summary?.text || '',
  recentScreenshots: screenshots.slice(0, 10).map(ss => ({
    id: ss.id,
    capturedAt: ss.captured_at,
    appName: ss.app_name || undefined,
    windowTitle: ss.window_title || undefined,
    analysis: ss.analysis || undefined,
  })),
  recentTranscripts: audioChunks
    .filter(c => c.transcript)
    .slice(-5)
    .map(c => c.transcript!),
  recentInsights: session.summary?.notes.map(n => n.content) || [],
  durationSeconds: session.duration || 0,
  analysisMode: 'ambient',
}
```

**Step 2: Update handleSuggestionClick with the same fix**

Find `handleSuggestionClick` (around line 209) and apply the same context fix.

**Step 3: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/SummaryView.tsx
git commit -m "$(cat <<'EOF'
fix(chat): load real screenshots and transcripts into QA context

Chat bot now has access to screenshot analyses and audio transcripts,
enabling it to answer questions about specific moments in the session.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Add Database Cleanup on Session Delete

**Files:**
- Modify: `src/services/database.ts` (add deleteSessionData function)
- Modify: `src/context/AppContext.tsx` (call it on delete)

**Step 1: Add deleteSessionData function to database.ts**

At the end of the file (before the last closing brace or export), add:

```typescript
/**
 * Delete all session data from database
 * Cascades to: screenshots, audio_chunks, insights, rolling_summaries, chat_messages
 */
export async function deleteSessionData(sessionId: string): Promise<void> {
  const db = await getDb()

  // Delete in order to respect foreign key constraints (if not using CASCADE)
  await db.execute('DELETE FROM chat_messages WHERE session_id = $1', [sessionId])
  await db.execute('DELETE FROM insights WHERE session_id = $1', [sessionId])
  await db.execute('DELETE FROM rolling_summaries WHERE session_id = $1', [sessionId])
  await db.execute('DELETE FROM audio_chunks WHERE session_id = $1', [sessionId])
  await db.execute('DELETE FROM screenshots WHERE session_id = $1', [sessionId])
  await db.execute('DELETE FROM sessions WHERE id = $1', [sessionId])

  console.log('[DATABASE] Deleted session data:', sessionId)
}
```

**Step 2: Update AppContext to call deleteSessionData**

In `src/context/AppContext.tsx`, find the `deleteSession` function and update it:

```typescript
const deleteSession = async (id: string) => {
  dispatch({ type: 'DELETE_SESSION', payload: id })

  // Delete from database first (includes all related data)
  try {
    await deleteSessionData(id)
  } catch (err) {
    console.error('Failed to delete session from database:', err)
  }

  // Then delete from localStorage
  await storage.deleteSession(id)
}
```

**Step 3: Add import for deleteSessionData**

At the top of AppContext.tsx, add to the database imports:

```typescript
import { initDb, createSession, deleteSessionData } from '../services/database'
```

**Step 4: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/services/database.ts src/context/AppContext.tsx
git commit -m "$(cat <<'EOF'
fix(delete): clean up database when session is deleted

Sessions are now fully removed from both SQLite and localStorage,
preventing orphaned data from accumulating in the database.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Surface Recording Stop Errors

**Files:**
- Modify: `src/services/recording.ts`

**Step 1: Update stopRecording to collect and report errors**

Find the `stopRecording` method (around line 356). Rewrite to collect errors:

```typescript
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
    } else if (this.screenshotInterval) {
      clearInterval(this.screenshotInterval)
      this.screenshotInterval = null
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
```

**Step 2: Handle errors in SessionRecording**

In `SessionRecording.tsx`, update the stopRecording call (around line 247):

```typescript
let screenshots: string[] = []
let stopWarnings: string[] = []
if (sessionRecorder.isRecording()) {
  const recordingState = await sessionRecorder.stopRecording()
  screenshots = recordingState.screenshots
  stopWarnings = (recordingState as any).stopErrors || []
  console.log('Captured ' + screenshots.length + ' screenshots')

  // Show warnings for stop errors (but continue processing)
  if (stopWarnings.length > 0) {
    for (const warning of stopWarnings) {
      showToast(warning, 'error', 5000)
    }
  }
}
```

**Step 3: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/services/recording.ts src/components/SessionRecording.tsx
git commit -m "$(cat <<'EOF'
fix(recording): surface errors when stopping recording

Recording stop errors are now collected and shown to the user via
toast notifications instead of being silently swallowed.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Add End Session Confirmation Dialog

**Files:**
- Create: `src/components/ConfirmDialog.tsx`
- Modify: `src/components/SessionRecording.tsx`

**Step 1: Create ConfirmDialog component**

```typescript
/**
 * ConfirmDialog
 *
 * Reusable confirmation dialog with customizable title, message, and actions.
 */

import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  confirmVariant?: 'danger' | 'primary'
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  confirmVariant = 'primary',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={onCancel}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-sm mx-4 bg-[var(--paper)] rounded-2xl border border-[var(--border-subtle)] shadow-[var(--shadow-xl)] overflow-hidden"
        >
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                confirmVariant === 'danger' ? 'bg-[var(--error-muted)]' : 'bg-[var(--accent-muted)]'
              }`}>
                <AlertTriangle className={`w-5 h-5 ${
                  confirmVariant === 'danger' ? 'text-[var(--error)]' : 'text-[var(--accent)]'
                }`} />
              </div>
              <div>
                <h3 className="font-medium text-[var(--ink)] text-lg">{title}</h3>
                <p className="text-sm text-[var(--ink-muted)] mt-1">{message}</p>
              </div>
            </div>
          </div>

          <div className="px-6 py-4 bg-[var(--paper-warm)] border-t border-[var(--border-subtle)] flex justify-end gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg border border-[var(--border-medium)] text-[var(--ink)] hover:bg-[var(--paper)] transition-colors text-sm"
            >
              {cancelText}
            </button>
            <button
              onClick={onConfirm}
              className={`px-4 py-2 rounded-lg text-white font-medium transition-colors text-sm ${
                confirmVariant === 'danger'
                  ? 'bg-[var(--error)] hover:bg-[var(--error)]/80'
                  : 'bg-[var(--accent)] hover:bg-[var(--accent)]/80'
              }`}
            >
              {confirmText}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
```

**Step 2: Add confirmation state and dialog to SessionRecording**

Add import at top:
```typescript
import { ConfirmDialog } from './ConfirmDialog'
```

Add state after other useState calls:
```typescript
const [showEndConfirm, setShowEndConfirm] = useState(false)
```

Update the End button onClick (around line 583):
```typescript
<motion.button
  onClick={() => setShowEndConfirm(true)}  // Changed from handleEndSession
  whileHover={{ scale: 1.05 }}
  // ...
>
```

Add the dialog at the end of the component (before the final `</motion.div>`):
```typescript
{/* End Session Confirmation */}
<ConfirmDialog
  isOpen={showEndConfirm}
  title="End Session?"
  message="Recording will stop and AI will process your session. This may take a moment."
  confirmText="End Session"
  cancelText="Keep Recording"
  confirmVariant="danger"
  onConfirm={() => {
    setShowEndConfirm(false)
    handleEndSession()
  }}
  onCancel={() => setShowEndConfirm(false)}
/>
```

**Step 3: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/ConfirmDialog.tsx src/components/SessionRecording.tsx
git commit -m "$(cat <<'EOF'
feat(recording): add confirmation dialog before ending session

Users must now confirm before ending a session, preventing accidental
clicks from stopping recording prematurely.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Add Progress Steps During End Session Processing

**Files:**
- Modify: `src/components/SessionRecording.tsx`

**Step 1: Add progress state**

After the other useState calls, add:

```typescript
const [processingStep, setProcessingStep] = useState<string>('')
const [processingPercent, setProcessingPercent] = useState(0)
```

**Step 2: Update handleEndSession with progress updates**

Update the `handleEndSession` function to set progress at each step:

```typescript
const handleEndSession = async () => {
  setIsEnding(true)
  setProcessingStep('Stopping recording...')
  setProcessingPercent(10)

  try {
    // Stop session coordinator
    setProcessingStep('Stopping AI analysis...')
    setProcessingPercent(20)
    await sessionCoordinator.stopSession(sessionIdRef.current)

    // Stop recording and get captured data
    setProcessingStep('Finalizing captures...')
    setProcessingPercent(30)
    let screenshots: string[] = []
    let stopWarnings: string[] = []
    if (sessionRecorder.isRecording()) {
      const recordingState = await sessionRecorder.stopRecording()
      screenshots = recordingState.screenshots
      stopWarnings = (recordingState as any).stopErrors || []

      if (stopWarnings.length > 0) {
        for (const warning of stopWarnings) {
          showToast(warning, 'error', 5000)
        }
      }
    }

    // Update database session status
    setProcessingStep('Gathering session data...')
    setProcessingPercent(40)
    await updateSessionStatus(sessionIdRef.current, 'processing', duration)

    // Gather all intelligence from database
    setProcessingPercent(50)
    const [rollingSummary, insights, audioChunks, dbScreenshots] = await Promise.all([
      getRollingSummary(sessionIdRef.current),
      getInsights(sessionIdRef.current),
      getAudioChunks(sessionIdRef.current),
      getScreenshots(sessionIdRef.current),
    ])

    // Generate final summary
    setProcessingStep('Generating AI summary...')
    setProcessingPercent(60)

    await initializeBots()

    // ... rest of summary generation logic ...

    setProcessingStep('Saving session...')
    setProcessingPercent(90)

    await updateSessionStatus(sessionIdRef.current, 'complete', duration)
    await addSession(session)

    setProcessingStep('Complete!')
    setProcessingPercent(100)

    dispatch({ type: 'STOP_RECORDING' })
    onComplete(session)
  } catch (error) {
    // ... error handling ...
  }
}
```

**Step 3: Update the processing UI to show progress**

Find the `isEnding` UI section (around line 404) and update:

```typescript
{isEnding ? (
  <motion.div
    initial={{ opacity: 0, scale: 0.95 }}
    animate={{ opacity: 1, scale: 1 }}
    className="text-center"
  >
    {/* Geometric animation */}
    <div className="relative w-32 h-32 mx-auto mb-10">
      {/* ... existing animation ... */}
    </div>

    <motion.h2
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="font-display text-2xl text-[var(--paper)] mb-3"
    >
      {processingStep || 'Processing your session'}
    </motion.h2>

    {/* Progress bar */}
    <div className="w-64 mx-auto mb-4">
      <div className="h-1.5 bg-[var(--paper)]/20 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-[var(--accent)]"
          initial={{ width: 0 }}
          animate={{ width: `${processingPercent}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>
      <p className="text-xs text-[var(--paper)]/40 mt-2">{processingPercent}%</p>
    </div>

    <p className="text-[var(--paper)]/60">
      Analyzing {formatTime(duration)} of work
    </p>
  </motion.div>
) : // ...
```

**Step 4: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/components/SessionRecording.tsx
git commit -m "$(cat <<'EOF'
feat(recording): add granular progress steps during end processing

Users now see specific progress steps and percentage during session
processing instead of a generic "Processing" message.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Fix Error Recovery - Don't Return to Recording State

**Files:**
- Modify: `src/components/SessionRecording.tsx`

**Step 1: Add error state instead of returning to recording**

Add new state:
```typescript
const [fatalError, setFatalError] = useState<string | null>(null)
```

**Step 2: Update the catch block in handleEndSession**

Replace the current catch block (around line 342):

```typescript
} catch (error) {
  console.error('Failed to end session:', error)

  // Update database status to error state
  try {
    await updateSessionStatus(sessionIdRef.current, 'error', duration)
  } catch (dbError) {
    console.error('Failed to update session status:', dbError)
  }

  // Determine specific error message
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

  // Show error state instead of returning to recording
  setFatalError(errorMessage)
  setIsEnding(false)
  setProcessingStep('')
  setProcessingPercent(0)
}
```

**Step 3: Add fatal error UI**

After the `isEnding` block and before the recording UI, add:

```typescript
) : fatalError ? (
  /* Fatal error state */
  <motion.div
    initial={{ opacity: 0, scale: 0.95 }}
    animate={{ opacity: 1, scale: 1 }}
    className="text-center max-w-md px-6"
  >
    <div className="w-16 h-16 mx-auto mb-8 rounded-2xl bg-[var(--error)]/20 flex items-center justify-center">
      <AlertCircle className="w-8 h-8 text-[var(--error)]" />
    </div>
    <h2 className="font-display text-2xl text-[var(--paper)] mb-3">
      Processing Failed
    </h2>
    <p className="text-[var(--paper)]/60 mb-8">
      {fatalError}
    </p>
    <div className="flex gap-4 justify-center">
      <button
        onClick={() => {
          setFatalError(null)
          handleEndSession()
        }}
        className="px-6 py-3 rounded-xl bg-[var(--accent)] text-white hover:bg-[var(--accent)]/80 transition-colors"
      >
        Try Again
      </button>
      <button
        onClick={() => {
          // Save session with fallback summary
          const fallbackSession: Session = {
            id: sessionIdRef.current,
            type: 'session',
            title: sessionTitle || 'Untitled Session',
            createdAt: new Date().toISOString(),
            duration,
            summary: {
              text: `Session recorded for ${Math.floor(duration / 60)} minutes. AI processing failed - please try regenerating the summary.`,
              tasks: [],
              notes: [],
              generatedAt: new Date().toISOString(),
            },
          }
          addSession(fallbackSession)
          dispatch({ type: 'STOP_RECORDING' })
          onComplete(fallbackSession)
        }}
        className="px-6 py-3 rounded-xl border border-[var(--paper)]/20 text-[var(--paper)]/80 hover:bg-[var(--paper)]/10 transition-colors"
      >
        Save Without AI Summary
      </button>
    </div>
  </motion.div>
) : permissionError ? (
```

**Step 4: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/components/SessionRecording.tsx
git commit -m "$(cat <<'EOF'
fix(recording): show error state instead of broken recording state

When session processing fails, users now see a clear error screen with
options to retry or save without AI summary, instead of returning to
a broken recording state.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Add Click to Skip Typewriter Animation

**Files:**
- Modify: `src/components/SummaryView.tsx`

**Step 1: Update the TypewriterText wrapper to support click-to-skip**

Find the typewriter rendering (around line 376) and wrap it:

```typescript
{/* Summary text - editorial style */}
<div
  className="font-display text-xl md:text-2xl leading-relaxed text-[var(--ink)] drop-cap cursor-pointer"
  onClick={() => setShowTypewriter(false)}
  title="Click to skip animation"
>
  {showTypewriter ? (
    <TypewriterText
      text={summary.text}
      onComplete={() => setShowTypewriter(false)}
    />
  ) : (
    summary.text
  )}
</div>
```

**Step 2: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/SummaryView.tsx
git commit -m "$(cat <<'EOF'
feat(summary): click to skip typewriter animation

Users can now click on the summary text to immediately complete the
typewriter animation instead of waiting for it to finish.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Fix "+N more" Screenshots to Actually Work

**Files:**
- Modify: `src/components/ScreenshotGallery.tsx`

**Step 1: Add expanded state and update the "+N more" button**

Add state at the top of the component:
```typescript
const [showAll, setShowAll] = useState(false)
```

Update the grid to show all when expanded:
```typescript
<div className="grid grid-cols-3 gap-3">
  {(showAll ? screenshots : screenshots.slice(0, 9)).map((ss, index) => (
    <button
      key={ss.id}
      onClick={() => setSelectedIndex(index)}
      className="relative aspect-video rounded-lg overflow-hidden bg-[var(--paper-dark)] hover:ring-2 hover:ring-[var(--accent)] transition-all"
    >
      {/* ... existing thumbnail content ... */}
    </button>
  ))}

  {/* Show more/less button */}
  {screenshots.length > 9 && (
    <button
      onClick={() => setShowAll(!showAll)}
      className="aspect-video rounded-lg bg-[var(--paper-dark)] border border-[var(--border-subtle)] flex items-center justify-center hover:bg-[var(--paper-warm)] transition-colors"
    >
      <span className="text-sm text-[var(--ink-muted)]">
        {showAll ? 'Show less' : `+${screenshots.length - 9} more`}
      </span>
    </button>
  )}
</div>
```

**Step 2: Fix the selectedIndex when showing all**

When showing all screenshots, the index mapping changes. Update selectedIndex handling:

```typescript
// At the top, derive the display list
const displayedScreenshots = showAll ? screenshots : screenshots.slice(0, 9)

// In the grid
{displayedScreenshots.map((ss, index) => (
  <button
    key={ss.id}
    onClick={() => setSelectedIndex(showAll ? index : index)}
    // ...
  >
```

Actually, the index is already relative to the displayed list, so we need to map back to the full list for the lightbox:

```typescript
const selectedScreenshot = selectedIndex !== null ? screenshots[selectedIndex] : null
```

Wait, this needs more careful handling. Let me revise:

```typescript
export function ScreenshotGallery({ screenshots }: ScreenshotGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)

  if (screenshots.length === 0) return null

  const selectedScreenshot = selectedIndex !== null ? screenshots[selectedIndex] : null
  const displayCount = showAll ? screenshots.length : Math.min(9, screenshots.length)

  return (
    <div className="space-y-3">
      {/* Grid */}
      <div className="grid grid-cols-3 gap-3">
        {screenshots.slice(0, displayCount).map((ss, index) => (
          <button
            key={ss.id}
            onClick={() => setSelectedIndex(index)}
            className="relative aspect-video rounded-lg overflow-hidden bg-[var(--paper-dark)] hover:ring-2 hover:ring-[var(--accent)] transition-all"
          >
            {/* ... thumbnail ... */}
          </button>
        ))}

        {/* Show more/less toggle */}
        {screenshots.length > 9 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="aspect-video rounded-lg bg-[var(--paper-dark)] border border-dashed border-[var(--border-medium)] flex items-center justify-center hover:bg-[var(--paper-warm)] transition-colors"
          >
            <span className="text-sm text-[var(--ink-muted)]">
              {showAll ? 'Show less' : `+${screenshots.length - 9} more`}
            </span>
          </button>
        )}
      </div>

      {/* Lightbox - uses full screenshots array */}
      <AnimatePresence>
        {selectedScreenshot && (
          {/* ... lightbox navigates through ALL screenshots ... */}
        )}
      </AnimatePresence>
    </div>
  )
}
```

**Step 3: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/ScreenshotGallery.tsx
git commit -m "$(cat <<'EOF'
fix(gallery): make "+N more" button actually expand the gallery

Clicking "+N more" now shows all screenshots in the grid. Users can
also click "Show less" to collapse back to 9 thumbnails.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Add Keyboard Navigation to Screenshot Lightbox

**Files:**
- Modify: `src/components/ScreenshotGallery.tsx`

**Step 1: Add keyboard event listener**

Add a useEffect for keyboard handling:

```typescript
// Keyboard navigation for lightbox
useEffect(() => {
  if (selectedIndex === null) return

  const handleKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault()
        setSelectedIndex(prev => prev !== null && prev > 0 ? prev - 1 : prev)
        break
      case 'ArrowRight':
        e.preventDefault()
        setSelectedIndex(prev => prev !== null && prev < screenshots.length - 1 ? prev + 1 : prev)
        break
      case 'Escape':
        e.preventDefault()
        setSelectedIndex(null)
        break
    }
  }

  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [selectedIndex, screenshots.length])
```

**Step 2: Add keyboard hint to lightbox**

At the bottom of the lightbox, add:

```typescript
<div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-4 text-xs text-white/40">
  <span>← → Navigate</span>
  <span>ESC Close</span>
</div>
```

**Step 3: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/ScreenshotGallery.tsx
git commit -m "$(cat <<'EOF'
feat(gallery): add keyboard navigation to screenshot lightbox

Users can now use arrow keys to navigate between screenshots and
Escape to close the lightbox.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Add Session Title Editing in SummaryView

**Files:**
- Modify: `src/components/SummaryView.tsx`

**Step 1: Add editing state**

After the existing state declarations, add:

```typescript
const [isEditingTitle, setIsEditingTitle] = useState(false)
const [editedTitle, setEditedTitle] = useState(session.title)
const titleInputRef = useRef<HTMLInputElement>(null)
```

**Step 2: Add the ref import if not present**

Make sure `useRef` is imported:
```typescript
import { useState, useEffect, useRef } from 'react'
```

**Step 3: Replace the title display with editable version**

Find the title h1 (around line 349) and replace:

```typescript
{/* Title - click to edit */}
{isEditingTitle ? (
  <input
    ref={titleInputRef}
    type="text"
    value={editedTitle}
    onChange={(e) => setEditedTitle(e.target.value)}
    onBlur={async () => {
      setIsEditingTitle(false)
      if (editedTitle !== session.title && editedTitle.trim()) {
        const updatedSession = { ...session, title: editedTitle.trim() }
        await updateSession(updatedSession)
      } else {
        setEditedTitle(session.title) // Reset if empty
      }
    }}
    onKeyDown={(e) => {
      if (e.key === 'Enter') {
        e.currentTarget.blur()
      } else if (e.key === 'Escape') {
        setEditedTitle(session.title)
        setIsEditingTitle(false)
      }
    }}
    className="font-display text-4xl md:text-5xl font-light text-[var(--ink)] tracking-tight leading-tight bg-transparent border-b-2 border-[var(--accent)] outline-none w-full"
    autoFocus
  />
) : (
  <h1
    onClick={() => {
      setIsEditingTitle(true)
      setTimeout(() => titleInputRef.current?.focus(), 0)
    }}
    className="font-display text-4xl md:text-5xl font-light text-[var(--ink)] tracking-tight leading-tight cursor-pointer hover:text-[var(--ink)]/80 transition-colors"
    title="Click to edit title"
  >
    {session.title}
  </h1>
)}
```

**Step 4: Verify build passes**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/components/SummaryView.tsx
git commit -m "$(cat <<'EOF'
feat(summary): add click-to-edit session title

Users can now click on the session title in the summary view to edit
it inline. Changes are saved on blur or Enter.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Final Verification and Build Test

**Step 1: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Run full build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Run Rust check**

Run: `cd src-tauri && cargo check`
Expected: No errors (warnings OK)

**Step 4: Commit any final fixes**

---

## Summary of Fixes

After completing this plan:

| Issue | Fix |
|-------|-----|
| Screenshots in reverse order | Changed DB query to ASC |
| Chat missing context | Load screenshots/transcripts into context |
| Database not cleaned on delete | Added deleteSessionData function |
| Recording stop errors hidden | Collect and show as toasts |
| No end confirmation | Added ConfirmDialog |
| No progress feedback | Added step-by-step progress bar |
| Broken error recovery | Show error state with retry/fallback options |
| Can't skip typewriter | Click to complete animation |
| "+N more" broken | Actually expand/collapse gallery |
| No keyboard nav in lightbox | Arrow keys + Escape |
| Can't edit title | Click-to-edit in SummaryView |

**User Experience After Fixes:**
- Clear confirmation before ending session
- Step-by-step progress during processing
- Meaningful error messages with recovery options
- Chat can answer questions about specific moments
- Full screenshot gallery accessible
- Keyboard-friendly navigation
- Session titles are editable
- Data fully cleaned up on delete
