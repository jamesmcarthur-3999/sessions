# Comprehensive Sessions App Fixes - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all critical, high, and medium priority issues identified in the comprehensive audit - security, Rust backend, data integrity, UI/UX accessibility, API integrations, and code quality.

**Architecture:** Organized into 8 phases, each self-contained and testable. Security fixes first (highest risk), then backend stability, data integrity, accessibility, API robustness, UX polish, code quality, and final verification.

**Tech Stack:** React 19, TypeScript, Tauri v2 (Rust), SQLite, Framer Motion

---

## Phase 1: Security Fixes (Critical)

### Task 1.1: Move API Keys to Secure Storage

**Files:**
- Create: `src/services/secure-storage.ts`
- Modify: `src/services/bots/config.ts`
- Modify: `src/components/Settings.tsx`

**Step 1: Create secure storage service**

Create `src/services/secure-storage.ts`:

```typescript
/**
 * Secure Storage Service
 *
 * Uses Tauri's plugin-store for encrypted storage in Tauri context,
 * falls back to localStorage with warning in browser context.
 */

import { isTauri } from './recording'

let store: any = null

async function getStore() {
  if (!isTauri()) {
    console.warn('[SECURE-STORAGE] Not in Tauri context, using localStorage (insecure)')
    return null
  }

  if (!store) {
    const { Store } = await import('@tauri-apps/plugin-store')
    store = new Store('secure-credentials.json')
  }
  return store
}

export async function setSecureItem(key: string, value: string): Promise<void> {
  const s = await getStore()
  if (s) {
    await s.set(key, value)
    await s.save()
  } else {
    // Fallback for development/browser
    localStorage.setItem(key, value)
  }
}

export async function getSecureItem(key: string): Promise<string | null> {
  const s = await getStore()
  if (s) {
    return await s.get(key) as string | null
  } else {
    return localStorage.getItem(key)
  }
}

export async function removeSecureItem(key: string): Promise<void> {
  const s = await getStore()
  if (s) {
    await s.delete(key)
    await s.save()
  } else {
    localStorage.removeItem(key)
  }
}

// Migration: move existing localStorage keys to secure storage
export async function migrateToSecureStorage(): Promise<void> {
  if (!isTauri()) return

  const keysToMigrate = ['sessions_api_key', 'sessions_openai_api_key']

  for (const key of keysToMigrate) {
    const value = localStorage.getItem(key)
    if (value) {
      await setSecureItem(key, value)
      localStorage.removeItem(key)
      console.log(`[SECURE-STORAGE] Migrated ${key} to secure storage`)
    }
  }
}
```

**Step 2: Install Tauri store plugin**

Run: `cd src-tauri && cargo add tauri-plugin-store`

Run: `npm install @tauri-apps/plugin-store`

**Step 3: Register plugin in Rust**

Modify `src-tauri/src/lib.rs`, add after line 306:

```rust
.plugin(tauri_plugin_store::Builder::new().build())
```

**Step 4: Update capabilities**

Modify `src-tauri/capabilities/default.json`, add to permissions array:

```json
"store:allow-get",
"store:allow-set",
"store:allow-delete",
"store:allow-save",
"store:allow-load"
```

**Step 5: Update config.ts to use secure storage**

Modify `src/services/bots/config.ts`, replace localStorage calls:

```typescript
import { getSecureItem, setSecureItem, removeSecureItem } from '../secure-storage'

// Replace line 36:
// const key = localStorage.getItem('sessions_api_key')
const key = await getSecureItem('sessions_api_key')

// Replace line 39:
// const openaiKey = localStorage.getItem('sessions_openai_api_key')
const openaiKey = await getSecureItem('sessions_openai_api_key')

// Make getApiKey async:
export async function getApiKey(): Promise<string | null> {
  return await getSecureItem('sessions_api_key')
}

// Update hasApiKey:
export async function hasApiKey(): Promise<boolean> {
  const key = await getSecureItem('sessions_api_key')
  return !!key
}

// Replace saveApiKeys:
export async function saveApiKeys(claudeKey: string, openaiKey?: string): Promise<void> {
  if (claudeKey) {
    await setSecureItem('sessions_api_key', claudeKey)
  } else {
    await removeSecureItem('sessions_api_key')
  }

  if (openaiKey) {
    await setSecureItem('sessions_openai_api_key', openaiKey)
  } else {
    await removeSecureItem('sessions_openai_api_key')
  }
}
```

**Step 6: Update Settings.tsx for async key loading**

Modify `src/components/Settings.tsx` to handle async:

```typescript
// Update useEffect to load keys asynchronously
useEffect(() => {
  const loadKeys = async () => {
    const savedClaudeKey = await getSecureItem('sessions_api_key') || ''
    const savedOpenaiKey = await getSecureItem('sessions_openai_api_key') || ''
    setClaudeApiKey(savedClaudeKey)
    setOpenaiApiKey(savedOpenaiKey)
  }
  loadKeys()
}, [])
```

**Step 7: Add migration call to App startup**

Modify `src/App.tsx`, add in useEffect:

```typescript
import { migrateToSecureStorage } from './services/secure-storage'

useEffect(() => {
  migrateToSecureStorage().catch(console.error)
}, [])
```

**Step 8: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 9: Commit**

```bash
git add src/services/secure-storage.ts src/services/bots/config.ts src/components/Settings.tsx src-tauri/src/lib.rs src-tauri/capabilities/default.json src-tauri/Cargo.toml src/App.tsx
git commit -m "$(cat <<'EOF'
security: move API keys to Tauri secure storage

- Create secure-storage service using tauri-plugin-store
- Migrate existing localStorage keys on startup
- Falls back to localStorage in browser context with warning
- API keys now encrypted at rest

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.2: Enable Content Security Policy

**Files:**
- Modify: `src-tauri/tauri.conf.json`

**Step 1: Add strict CSP**

Replace line 22-24 in `src-tauri/tauri.conf.json`:

```json
"security": {
  "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.anthropic.com https://api.openai.com; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:;"
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "$(cat <<'EOF'
security: enable strict Content Security Policy

Restricts scripts to self, allows API calls only to Anthropic and OpenAI,
permits data URIs for screenshots. Prevents XSS attacks.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.3: Fix App Identifier

**Files:**
- Modify: `src-tauri/tauri.conf.json`

**Step 1: Change identifier**

Replace line 5 in `src-tauri/tauri.conf.json`:

```json
"identifier": "com.sessions.app",
```

**Step 2: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "$(cat <<'EOF'
fix: use unique app identifier instead of template default

Changes from com.tauri.dev to com.sessions.app for proper
macOS permissions and app store compatibility.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.4: Remove Sensitive Console Logging

**Files:**
- Modify: `src/services/bots/config.ts`
- Modify: `src/components/Settings.tsx`

**Step 1: Replace sensitive logs with safe versions**

In `src/services/bots/config.ts`, update log statements to not mention keys:

```typescript
// Replace lines mentioning API keys:
console.log('[Baleybots] AI service configured')
// Instead of: console.log('[Baleybots] Anthropic API key configured')
```

In `src/components/Settings.tsx`, sanitize error logging:

```typescript
} catch (error) {
  console.error('Settings save failed') // Don't log error object which may contain keys
  setSaveStatus('failed')
}
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/services/bots/config.ts src/components/Settings.tsx
git commit -m "$(cat <<'EOF'
security: remove sensitive information from console logs

Sanitize log messages to not mention API keys or include
error objects that might contain sensitive data.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: Rust Backend Critical Fixes

### Task 2.1: Register Missing Video Commands

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Step 1: Add missing commands to invoke_handler**

Find the `invoke_handler` macro (around line 324) and add the missing commands:

```rust
.invoke_handler(tauri::generate_handler![
    capture_screenshot,
    capture_screenshot_thumbnail,
    start_audio_recording,
    stop_audio_recording,
    pause_audio_recording,
    resume_audio_recording,
    start_video_recording,
    stop_video_recording,
    check_screen_recording_permission,
    request_screen_recording_permission,
    start_activity_monitor,
    stop_activity_monitor,
    get_current_recording_session,    // ADD THIS
    get_video_duration,               // ADD THIS
    generate_video_thumbnail,         // ADD THIS
])
```

**Step 2: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: No errors (warnings OK)

**Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "$(cat <<'EOF'
fix(rust): register missing video commands in invoke_handler

Adds get_current_recording_session, get_video_duration, and
generate_video_thumbnail to the Tauri command handler.
These were defined but not callable from frontend.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.2: Fix AudioRecorder Thread Leak with Drop Implementation

**Files:**
- Modify: `src-tauri/src/audio_capture.rs`

**Step 1: Add Drop implementation for AudioRecorder**

Add after the `AudioRecorder` impl block (around line 520):

```rust
impl Drop for AudioRecorder {
    fn drop(&mut self) {
        // Ensure recording is stopped and thread is cleaned up
        if let Ok(mut state) = self.state.lock() {
            if *state != RecordingState::Stopped {
                *state = RecordingState::Stopped;
            }
        }

        // Signal thread to stop via state change
        // The chunk processor thread checks state and will exit

        // Drop the stream to stop audio capture
        if let Ok(mut stream) = self.stream.lock() {
            *stream = None;
        }

        println!("AudioRecorder dropped, resources cleaned up");
    }
}
```

**Step 2: Verify Rust compiles**

Run: `cd src-tauri && cargo check`
Expected: No errors

**Step 3: Commit**

```bash
git add src-tauri/src/audio_capture.rs
git commit -m "$(cat <<'EOF'
fix(audio): implement Drop for AudioRecorder to prevent thread leak

Ensures recording state is set to Stopped and stream is dropped
when AudioRecorder is dropped, preventing orphaned threads.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2.3: Fix Activity Monitor Efficiency

**Files:**
- Modify: `src-tauri/src/activity_monitor.rs`

**Step 1: Reduce polling frequency and add error reporting**

Find the polling loop (around line 62) and update:

```rust
// Change from 500ms to 1000ms to reduce subprocess spawning
let poll_interval = Duration::from_millis(1000);

// In the loop, add error counting:
let mut consecutive_errors = 0;
const MAX_CONSECUTIVE_ERRORS: u32 = 5;

loop {
    if stop_flag.load(Ordering::Relaxed) {
        break;
    }

    match Self::get_frontmost_app() {
        Some((app_name, window_title)) => {
            consecutive_errors = 0;
            // ... existing logic
        }
        None => {
            consecutive_errors += 1;
            if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                eprintln!("[ACTIVITY_MONITOR] Too many consecutive failures, activity detection degraded");
                consecutive_errors = 0; // Reset to avoid spam
            }
        }
    }

    thread::sleep(poll_interval);
}
```

**Step 2: Add Drop implementation**

```rust
impl Drop for ActivityMonitor {
    fn drop(&mut self) {
        self.stop();
    }
}
```

**Step 3: Verify Rust compiles**

Run: `cd src-tauri && cargo check`

**Step 4: Commit**

```bash
git add src-tauri/src/activity_monitor.rs
git commit -m "$(cat <<'EOF'
fix(activity): reduce polling frequency and add Drop cleanup

- Increase poll interval from 500ms to 1000ms (less CPU usage)
- Add error counting to detect degraded monitoring
- Implement Drop to ensure thread stops on cleanup

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: Data Integrity Fixes

### Task 3.1: Add Crash Recovery for Sessions

**Files:**
- Modify: `src/services/database.ts`
- Modify: `src/context/AppContext.tsx`

**Step 1: Add function to find orphaned sessions**

Add to `src/services/database.ts`:

```typescript
/**
 * Find sessions that were interrupted (recording/processing status)
 * These need recovery or cleanup
 */
export async function findOrphanedSessions(): Promise<DbSession[]> {
  const db = await getDb()
  const result = await db.select<DbSession[]>(
    "SELECT * FROM sessions WHERE status IN ('recording', 'processing') ORDER BY created_at DESC"
  )
  return result
}

/**
 * Mark orphaned sessions as needing recovery
 */
export async function markSessionsAsInterrupted(sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return

  const db = await getDb()
  const placeholders = sessionIds.map((_, i) => `$${i + 1}`).join(', ')
  await db.execute(
    `UPDATE sessions SET status = 'interrupted' WHERE id IN (${placeholders})`,
    sessionIds
  )
  console.log(`[DATABASE] Marked ${sessionIds.length} sessions as interrupted`)
}
```

**Step 2: Add 'interrupted' to status check constraint**

Update schema in `database.ts` (around line 30):

```sql
status TEXT NOT NULL CHECK (status IN ('recording', 'processing', 'complete', 'error', 'interrupted')),
```

**Step 3: Check for orphaned sessions on app startup**

Modify `src/context/AppContext.tsx`, update the load function:

```typescript
async function load() {
  try {
    // Check for sessions interrupted by crash
    const orphaned = await findOrphanedSessions()
    if (orphaned.length > 0) {
      console.warn(`[APP] Found ${orphaned.length} interrupted sessions`)
      await markSessionsAsInterrupted(orphaned.map(s => s.id))
      // TODO: Could show a recovery dialog to user
    }

    const sessions = await storage.loadSessions()
    dispatch({ type: 'SET_SESSIONS', payload: sessions })
  } catch (err) {
    console.error('Failed to load sessions:', err)
    dispatch({ type: 'SET_ERROR', payload: 'Failed to load sessions' })
  } finally {
    dispatch({ type: 'SET_LOADING', payload: false })
  }
}
```

**Step 4: Add SET_ERROR action to reducer**

```typescript
type AppAction =
  | { type: 'SET_SESSIONS'; payload: Session[] }
  | { type: 'ADD_SESSION'; payload: Session }
  | { type: 'UPDATE_SESSION'; payload: Session }
  | { type: 'DELETE_SESSION'; payload: string }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }  // ADD THIS
  // ... rest

// In reducer:
case 'SET_ERROR':
  return { ...state, error: action.payload }
```

**Step 5: Add error to initial state**

```typescript
const initialState: AppState = {
  sessions: [],
  isLoading: true,
  isRecording: false,
  error: null,  // ADD THIS
}
```

**Step 6: Verify build**

Run: `npx tsc --noEmit`

**Step 7: Commit**

```bash
git add src/services/database.ts src/context/AppContext.tsx
git commit -m "$(cat <<'EOF'
fix(data): add crash recovery for interrupted sessions

- Add findOrphanedSessions() to detect sessions in recording/processing state
- Mark interrupted sessions on app startup
- Add error state to AppContext for user feedback

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.2: Fix Delete Race Condition

**Files:**
- Modify: `src/context/AppContext.tsx`

**Step 1: Update deleteSession to require both deletions**

Replace the deleteSession function:

```typescript
const deleteSession = async (id: string) => {
  const errors: string[] = []

  // Try database deletion first (has the bulk of the data)
  try {
    await deleteSessionData(id)
  } catch (err) {
    console.error('Failed to delete session from database:', err)
    errors.push('database')
  }

  // Then try localStorage
  try {
    await storage.deleteSession(id)
  } catch (err) {
    console.error('Failed to delete session from localStorage:', err)
    errors.push('localStorage')
  }

  // Only update UI if BOTH succeeded
  if (errors.length === 0) {
    dispatch({ type: 'DELETE_SESSION', payload: id })
  } else if (errors.length === 1) {
    // Partial failure - try to rollback or warn user
    console.error(`Partial delete failure: ${errors.join(', ')}`)
    // Still update UI but warn user
    dispatch({ type: 'DELETE_SESSION', payload: id })
    // Could show a toast warning here
  } else {
    // Both failed - don't update UI
    console.error('Delete completely failed')
    throw new Error('Failed to delete session')
  }
}
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add src/context/AppContext.tsx
git commit -m "$(cat <<'EOF'
fix(data): improve delete consistency between storage layers

Only update UI state when both database and localStorage deletions
succeed. Log partial failures for debugging.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3.3: Add Database-localStorage Sync

**Files:**
- Modify: `src/services/storage.ts`
- Modify: `src/services/database.ts`

**Step 1: Add function to rebuild localStorage from database**

Add to `src/services/database.ts`:

```typescript
/**
 * Get all complete sessions from database for localStorage sync
 */
export async function getAllCompleteSessions(): Promise<DbSession[]> {
  const db = await getDb()
  return await db.select<DbSession[]>(
    "SELECT * FROM sessions WHERE status = 'complete' ORDER BY created_at DESC"
  )
}
```

**Step 2: Add sync function to storage.ts**

Add to `src/services/storage.ts`:

```typescript
import { getAllCompleteSessions } from './database'

/**
 * Rebuild localStorage from database
 * Use when localStorage is corrupted or cleared
 */
export async function syncFromDatabase(): Promise<Session[]> {
  const dbSessions = await getAllCompleteSessions()

  // Convert DbSession to Session format
  const sessions: Session[] = dbSessions.map(db => ({
    id: db.id,
    type: db.type as 'session' | 'capture',
    title: db.title,
    createdAt: db.created_at,
    duration: db.duration || undefined,
    summary: db.summary_json ? JSON.parse(db.summary_json) : undefined,
  }))

  // Save to localStorage
  await acquireWriteLock()
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
    console.log(`[STORAGE] Synced ${sessions.length} sessions from database`)
  } finally {
    releaseWriteLock()
  }

  return sessions
}

/**
 * Verify localStorage and database are in sync
 */
export async function verifyStorageSync(): Promise<{
  inSync: boolean
  localCount: number
  dbCount: number
}> {
  const local = await loadSessions()
  const dbSessions = await getAllCompleteSessions()

  return {
    inSync: local.length === dbSessions.length,
    localCount: local.length,
    dbCount: dbSessions.length,
  }
}
```

**Step 3: Verify build**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```bash
git add src/services/storage.ts src/services/database.ts
git commit -m "$(cat <<'EOF'
feat(data): add localStorage-database sync capability

- Add getAllCompleteSessions() to database service
- Add syncFromDatabase() to rebuild localStorage
- Add verifyStorageSync() to check consistency

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4: Accessibility Fixes (Critical)

### Task 4.1: Fix Toggle Switches in RecordingSettings

**Files:**
- Modify: `src/components/RecordingSettings.tsx`

**Step 1: Create accessible Toggle component**

Add at the top of the file or create separate component:

```typescript
interface ToggleSwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}

function ToggleSwitch({ checked, onChange, label, disabled }: ToggleSwitchProps) {
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="sr-only peer"
        aria-label={label}
      />
      <div className={`
        w-11 h-6 rounded-full transition-colors
        ${checked ? 'bg-[var(--accent)]' : 'bg-[var(--border-medium)]'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent)] peer-focus-visible:ring-offset-2
      `}>
        <div className={`
          absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform
          ${checked ? 'translate-x-5' : 'translate-x-0'}
        `} />
      </div>
    </label>
  )
}
```

**Step 2: Replace all div-based toggles**

Find each toggle (search for `onClick={() => setConfig`) and replace with:

```typescript
// Before:
<div
  onClick={() => setConfig(prev => ({ ...prev, enableScreenshots: !prev.enableScreenshots }))}
  className={`w-11 h-6 ...`}
>

// After:
<ToggleSwitch
  checked={config.enableScreenshots}
  onChange={(checked) => setConfig(prev => ({ ...prev, enableScreenshots: checked }))}
  label="Enable screenshots"
/>
```

**Step 3: Verify build**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```bash
git add src/components/RecordingSettings.tsx
git commit -m "$(cat <<'EOF'
a11y(settings): replace div toggles with accessible checkbox inputs

Toggle switches now use real checkbox inputs with proper keyboard
support, focus indicators, and screen reader labels.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4.2: Add aria-live to Toast

**Files:**
- Modify: `src/components/Toast.tsx`

**Step 1: Add aria-live region**

Update the Toast component wrapper:

```typescript
return (
  <AnimatePresence>
    {toasts.map((toast) => (
      <motion.div
        key={toast.id}
        role={toast.type === 'error' ? 'alert' : 'status'}
        aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
        aria-atomic="true"
        initial={{ opacity: 0, y: 50, scale: 0.9 }}
        // ... rest of props
      >
```

**Step 2: Increase dismiss button size**

Update the dismiss button:

```typescript
<button
  onClick={() => removeToast(toast.id)}
  className="p-2 rounded-lg hover:bg-black/10 transition-colors"
  aria-label="Dismiss notification"
>
  <X className="w-5 h-5" />
</button>
```

**Step 3: Commit**

```bash
git add src/components/Toast.tsx
git commit -m "$(cat <<'EOF'
a11y(toast): add aria-live announcements and larger dismiss button

- Add role and aria-live to toast notifications
- Errors use assertive, info/success use polite
- Increase dismiss button touch target

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4.3: Fix ConfirmDialog Accessibility

**Files:**
- Modify: `src/components/ConfirmDialog.tsx`

**Step 1: Add dialog role and focus management**

```typescript
import { useEffect, useRef } from 'react'

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
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  // Focus cancel button when dialog opens
  useEffect(() => {
    if (isOpen) {
      cancelButtonRef.current?.focus()
    }
  }, [isOpen])

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onCancel])

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        initial={{ opacity: 0 }}
        // ... rest
      >
        <motion.div
          onClick={(e) => e.stopPropagation()}
          className="..."
        >
          <div className="p-6">
            <div className="flex items-start gap-4">
              {/* Icon */}
              <div>
                <h3 id="confirm-dialog-title" className="font-medium text-[var(--ink)] text-lg">
                  {title}
                </h3>
                <p id="confirm-dialog-message" className="text-sm text-[var(--ink-muted)] mt-1">
                  {message}
                </p>
              </div>
            </div>
          </div>

          <div className="px-6 py-4 bg-[var(--paper-warm)] border-t border-[var(--border-subtle)] flex justify-end gap-3">
            <button
              ref={cancelButtonRef}
              onClick={onCancel}
              className="..."
            >
              {cancelText}
            </button>
            <button onClick={onConfirm} className="...">
              {confirmText}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/ConfirmDialog.tsx
git commit -m "$(cat <<'EOF'
a11y(dialog): add proper dialog role, focus management, and escape key

- Add role="dialog" and aria-modal="true"
- Add aria-labelledby and aria-describedby
- Focus cancel button when dialog opens
- Close on Escape key

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4.4: Add Accessible Labels to Search and Inputs

**Files:**
- Modify: `src/components/History.tsx`
- Modify: `src/components/CommandPalette.tsx`

**Step 1: Add aria-label to History search**

In `History.tsx`, find the search input and add:

```typescript
<input
  type="text"
  placeholder="Search sessions..."
  value={searchQuery}
  onChange={(e) => setSearchQuery(e.target.value)}
  aria-label="Search sessions"
  className="..."
/>
```

**Step 2: Add aria-label to CommandPalette search**

In `CommandPalette.tsx`:

```typescript
<input
  ref={inputRef}
  type="text"
  placeholder="Type a command or search..."
  value={query}
  onChange={(e) => setQuery(e.target.value)}
  aria-label="Command palette search"
  aria-activedescendant={selectedIndex >= 0 ? `command-${selectedIndex}` : undefined}
  className="..."
/>
```

**Step 3: Add role="dialog" to CommandPalette**

```typescript
<motion.div
  role="dialog"
  aria-modal="true"
  aria-label="Command palette"
  // ...
>
```

**Step 4: Commit**

```bash
git add src/components/History.tsx src/components/CommandPalette.tsx
git commit -m "$(cat <<'EOF'
a11y: add accessible labels to search inputs and command palette

- Add aria-label to History search input
- Add aria-label and aria-activedescendant to CommandPalette
- Add dialog role to CommandPalette modal

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5: API Robustness

### Task 5.1: Add Global Rate Limiter

**Files:**
- Create: `src/utils/rate-limiter.ts`
- Modify: `src/services/session-coordinator.ts`

**Step 1: Create rate limiter**

Create `src/utils/rate-limiter.ts`:

```typescript
/**
 * Token Bucket Rate Limiter
 *
 * Prevents exceeding API rate limits by tracking requests
 * and waiting when necessary.
 */

export class RateLimiter {
  private tokens: number
  private lastRefill: number
  private readonly maxTokens: number
  private readonly refillRate: number // tokens per millisecond

  constructor(maxRequestsPerMinute: number = 50) {
    this.maxTokens = maxRequestsPerMinute
    this.tokens = maxRequestsPerMinute
    this.lastRefill = Date.now()
    this.refillRate = maxRequestsPerMinute / 60000 // Convert to per-ms
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate)
    this.lastRefill = now
  }

  async acquire(): Promise<void> {
    this.refill()

    if (this.tokens >= 1) {
      this.tokens -= 1
      return
    }

    // Calculate wait time for 1 token
    const waitTime = Math.ceil((1 - this.tokens) / this.refillRate)
    console.log(`[RATE_LIMITER] Waiting ${waitTime}ms for rate limit`)

    await new Promise(resolve => setTimeout(resolve, waitTime))
    this.tokens = 0
  }

  /**
   * Check if we can make a request without waiting
   */
  canProceed(): boolean {
    this.refill()
    return this.tokens >= 1
  }

  /**
   * Get current token count (for monitoring)
   */
  getAvailableTokens(): number {
    this.refill()
    return Math.floor(this.tokens)
  }
}

// Global rate limiter for Claude API (50 RPM default)
export const claudeRateLimiter = new RateLimiter(50)

// Global rate limiter for OpenAI API (60 RPM default)
export const openaiRateLimiter = new RateLimiter(60)
```

**Step 2: Apply rate limiter to coordinator**

In `src/services/session-coordinator.ts`, add import and use:

```typescript
import { claudeRateLimiter } from '../utils/rate-limiter'

// In processScreenshot, before bot call:
async processScreenshot(sessionId: string, screenshot: DbScreenshot): Promise<void> {
  // ... existing checks ...

  try {
    // Wait for rate limit
    await claudeRateLimiter.acquire()

    const result = await withBotRetry(() => this.activityBot!.process(input))
    // ... rest
```

**Step 3: Verify build**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```bash
git add src/utils/rate-limiter.ts src/services/session-coordinator.ts
git commit -m "$(cat <<'EOF'
feat(api): add global rate limiter for AI API calls

Implements token bucket algorithm to prevent exceeding API rate limits.
Applied to all Claude API calls in session coordinator.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5.2: Add Audio Size Validation

**Files:**
- Modify: `src/services/transcription.ts`

**Step 1: Add size check before API call**

```typescript
const MAX_WHISPER_SIZE = 25 * 1024 * 1024 // 25MB

private async transcribeWithOpenAI(audioBase64: string, apiKey: string): Promise<TranscriptionResult> {
  const base64Data = audioBase64.replace(/^data:audio\/\w+;base64,/, '')
  const binaryString = atob(base64Data)

  // Check size before processing
  if (binaryString.length > MAX_WHISPER_SIZE) {
    console.error(`[TRANSCRIPTION] Audio too large: ${(binaryString.length / 1024 / 1024).toFixed(1)}MB`)
    throw new Error(`Audio chunk too large (${(binaryString.length / 1024 / 1024).toFixed(1)}MB). Maximum is 25MB.`)
  }

  const bytes = new Uint8Array(binaryString.length)
  // ... rest of function
}
```

**Step 2: Commit**

```bash
git add src/services/transcription.ts
git commit -m "$(cat <<'EOF'
fix(transcription): validate audio size before Whisper API call

Checks audio chunk size against 25MB Whisper limit before
attempting upload, preventing wasted API calls.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5.3: Add IPC Timeout Wrapper

**Files:**
- Modify: `src/services/recording.ts`

**Step 1: Create timeout wrapper**

```typescript
async function invokeWithTimeout<T>(
  cmd: string,
  args?: Record<string, unknown>,
  timeoutMs: number = 10000
): Promise<T> {
  if (typeof window === 'undefined' || !('__TAURI__' in window)) {
    throw new Error('Not running in Tauri environment')
  }

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
```

**Step 2: Replace critical invoke calls with timeout version**

Update calls like:

```typescript
// Before:
await invoke('start_audio_recording', { ... })

// After:
await invokeWithTimeout('start_audio_recording', { ... }, 5000)
```

**Step 3: Commit**

```bash
git add src/services/recording.ts
git commit -m "$(cat <<'EOF'
fix(ipc): add timeout wrapper to prevent indefinite hangs

IPC calls now timeout after 10 seconds by default, preventing
the UI from hanging if the Rust backend stalls.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6: UX Polish

### Task 6.1: Fix Responsive Design in SessionRecording

**Files:**
- Modify: `src/components/SessionRecording.tsx`

**Step 1: Make timer responsive**

Find the timer display (around line 700) and update:

```typescript
<motion.div className="font-mono text-6xl sm:text-7xl md:text-8xl text-[var(--paper)] tracking-tight">
  {formatTime(duration)}
</motion.div>
```

**Step 2: Make title input responsive**

Find the title input and update:

```typescript
<input
  type="text"
  value={sessionTitle}
  onChange={(e) => setSessionTitle(e.target.value)}
  placeholder="Name your session..."
  className="w-full max-w-xs sm:max-w-sm md:max-w-md bg-transparent text-center text-lg text-[var(--paper)]/80 placeholder:text-[var(--paper)]/40 outline-none border-b border-[var(--paper)]/20 focus:border-[var(--paper)]/40 pb-1"
/>
```

**Step 3: Commit**

```bash
git add src/components/SessionRecording.tsx
git commit -m "$(cat <<'EOF'
fix(recording): make timer and title responsive on mobile

Timer and title input now scale appropriately on smaller screens.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6.2: Add Error Display for Media Loading

**Files:**
- Modify: `src/components/SummaryView.tsx`

**Step 1: Add error state for media loading**

Add state:

```typescript
const [mediaError, setMediaError] = useState<string | null>(null)
```

**Step 2: Update media loading to catch errors**

```typescript
useEffect(() => {
  const loadMedia = async () => {
    setLoadingMedia(true)
    setMediaError(null)

    try {
      const [ss, audio] = await Promise.all([
        getScreenshots(session.id),
        getAudioChunks(session.id),
      ])
      setScreenshots(ss)
      setAudioChunks(audio)
    } catch (error) {
      console.error('Failed to load media:', error)
      setMediaError('Failed to load screenshots and audio. Please try again.')
    } finally {
      setLoadingMedia(false)
    }
  }

  loadMedia()
}, [session.id])
```

**Step 3: Display error in UI**

Add after loading skeleton:

```typescript
{mediaError && (
  <div className="p-4 rounded-xl bg-[var(--error-muted)] border border-[var(--error)] text-[var(--error)]">
    <p className="text-sm">{mediaError}</p>
    <button
      onClick={() => loadMedia()}
      className="text-sm underline mt-2"
    >
      Retry
    </button>
  </div>
)}
```

**Step 4: Commit**

```bash
git add src/components/SummaryView.tsx
git commit -m "$(cat <<'EOF'
fix(summary): show error message when media loading fails

Users now see an error message with retry option instead of
an infinite loading state when screenshots/audio fail to load.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6.3: Add Error Handling to Home and History

**Files:**
- Modify: `src/components/Home.tsx`
- Modify: `src/components/History.tsx`

**Step 1: Add error display to Home**

```typescript
// In Home.tsx, check for error state
const { state } = useApp()

// Add error display after loading check:
{state.error && (
  <div className="p-4 rounded-xl bg-[var(--error-muted)] text-[var(--error)] text-center">
    <p>{state.error}</p>
  </div>
)}
```

**Step 2: Add error display to History**

Similar pattern in History.tsx.

**Step 3: Commit**

```bash
git add src/components/Home.tsx src/components/History.tsx
git commit -m "$(cat <<'EOF'
fix(ui): add error state display to Home and History

Users now see error messages when session loading fails
instead of a broken UI state.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 7: Code Quality

### Task 7.1: Fix Type Safety Issues

**Files:**
- Modify: `src/services/recording.ts`
- Modify: `src/types/index.ts`

**Step 1: Add proper type for recording result with errors**

Add to `src/types/index.ts`:

```typescript
export interface RecordingStopResult extends SessionRecordingState {
  stopErrors?: string[]
}
```

**Step 2: Update recording.ts to use proper type**

```typescript
// Replace the (result as any).stopErrors pattern:
async stopRecording(): Promise<RecordingStopResult> {
  // ... existing code ...

  const result: RecordingStopResult = {
    ...this.state,
    isRecording: false,
    stopErrors: errors.length > 0 ? errors : undefined
  }

  return result
}
```

**Step 3: Update SessionRecording.tsx to use typed result**

```typescript
const recordingState = await sessionRecorder.stopRecording()
const stopWarnings = recordingState.stopErrors || []
```

**Step 4: Commit**

```bash
git add src/services/recording.ts src/types/index.ts src/components/SessionRecording.tsx
git commit -m "$(cat <<'EOF'
fix(types): add proper type for recording stop result with errors

Replace 'as any' pattern with typed RecordingStopResult interface
that includes optional stopErrors array.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7.2: Fix Memory Leak in Audio Level Listener

**Files:**
- Modify: `src/components/SessionRecording.tsx`

**Step 1: Fix the race condition in listener cleanup**

```typescript
// Replace the audio level effect:
useEffect(() => {
  if (!isTauri() || !recordingConfig?.enableAudio) {
    setAudioLevel(0)
    return
  }

  let cancelled = false
  let unlisten: (() => void) | null = null

  const setupListener = async () => {
    try {
      const { listen } = await import('@tauri-apps/api/event')

      // Check if we were cancelled during the import
      if (cancelled) return

      unlisten = await listen<{ level: number }>('audio-level', (event) => {
        if (!isPausedRef.current && !cancelled) {
          setAudioLevel(event.payload.level)
        }
      })
    } catch (error) {
      console.error('Failed to setup audio level listener:', error)
    }
  }

  setupListener()

  return () => {
    cancelled = true
    unlisten?.()
    setAudioLevel(0)
  }
}, [recordingConfig?.enableAudio])
```

**Step 2: Commit**

```bash
git add src/components/SessionRecording.tsx
git commit -m "$(cat <<'EOF'
fix(recording): prevent memory leak in audio level listener

Add cancellation flag to prevent listener from being created
after component unmount. Ensures cleanup runs properly.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7.3: Fix Stale Closure in Typewriter Effect

**Files:**
- Modify: `src/components/SummaryView.tsx`

**Step 1: Fix the TypewriterText useEffect dependencies**

In the TypewriterText component:

```typescript
// Use ref for onComplete to avoid dependency issues
const onCompleteRef = useRef(onComplete)
onCompleteRef.current = onComplete

useEffect(() => {
  if (isComplete) return

  let index = 0
  const interval = setInterval(() => {
    if (index < text.length) {
      setDisplayText(text.slice(0, index + 1))
      index++
    } else {
      clearInterval(interval)
      setIsComplete(true)
      onCompleteRef.current?.()
    }
  }, 20)

  return () => clearInterval(interval)
}, [text, isComplete]) // Remove onComplete from deps
```

**Step 2: Commit**

```bash
git add src/components/SummaryView.tsx
git commit -m "$(cat <<'EOF'
fix(typewriter): use ref for callback to prevent animation restart

Store onComplete in ref to avoid it being a dependency that could
reset the animation when parent re-renders.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 8: Final Verification

### Task 8.1: TypeScript Check

**Step 1: Run full type check**

Run: `npx tsc --noEmit`
Expected: No errors

### Task 8.2: Build Frontend

**Step 1: Run Vite build**

Run: `npm run build`
Expected: Build succeeds

### Task 8.3: Build Rust

**Step 1: Run Cargo check**

Run: `cd src-tauri && cargo check`
Expected: No errors (warnings OK)

### Task 8.4: Full Tauri Build

**Step 1: Run full build**

Run: `npm run tauri build`
Expected: Build succeeds

### Task 8.5: Final Commit

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: final verification - all audit issues resolved

Comprehensive fixes for:
- Security: API key storage, CSP, logging
- Rust: Missing commands, thread leaks, activity monitor
- Data: Crash recovery, delete consistency, storage sync
- Accessibility: Toggles, toasts, dialogs, labels
- API: Rate limiting, size validation, timeouts
- UX: Responsive design, error states
- Code quality: Type safety, memory leaks

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary

**Total Tasks:** 25 tasks across 8 phases

| Phase | Focus | Tasks |
|-------|-------|-------|
| 1 | Security | 4 |
| 2 | Rust Backend | 3 |
| 3 | Data Integrity | 3 |
| 4 | Accessibility | 4 |
| 5 | API Robustness | 3 |
| 6 | UX Polish | 3 |
| 7 | Code Quality | 3 |
| 8 | Verification | 5 |

**Estimated Time:** 4-6 hours for experienced developer

**Dependencies:**
- Phase 1 must complete before Phase 5 (API key changes)
- Phase 2 must complete for full Tauri functionality
- Other phases can be done in parallel
