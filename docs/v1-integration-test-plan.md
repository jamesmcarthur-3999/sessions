# Sessions v1 - Integration Test Plan

Final verification checklist for v1 release.

## Pre-Test Setup

1. **API Keys Configured**
   - [ ] Claude API key set in Settings (required for AI features)
   - [ ] OpenAI API key set in Settings (required for audio transcription)

2. **Environment Ready**
   - [ ] `npm run tauri dev` starts without errors
   - [ ] Screen recording permission granted on macOS
   - [ ] Microphone permission granted (if testing audio)

---

## Test 1: Quick Capture

**Purpose:** Verify capture pipeline processes text and extracts insights.

### Steps
1. Navigate to Home
2. Click "Quick Capture" or press `⌘N`
3. Paste the following test content:
   ```
   Meeting notes from product sync:
   - Need to fix the login bug before Friday
   - Sarah will review the API docs tomorrow
   - TODO: Update the deployment script
   - We should consider adding dark mode
   ```
4. Click "Process" or press `⌘Enter`

### Expected Results
- [ ] Loading spinner appears during processing
- [ ] Title generated (2-6 words summarizing content)
- [ ] Summary paragraph appears
- [ ] Tasks extracted: "Fix login bug", "Update deployment script" (or similar)
- [ ] Notes extracted: Review mention, dark mode consideration
- [ ] No console errors

---

## Test 2: Session Recording - Basic Flow

**Purpose:** Verify end-to-end session recording with smart capture.

### Steps
1. Navigate to Home
2. Click "Start Session" or press `⇧⌘N`
3. Verify setup shows:
   - Screen selector (displays available screens)
   - Microphone selector (lists audio devices)
4. Select a screen (click thumbnail)
5. Optionally select microphone
6. Click "Start Recording"
7. Work normally for 60-90 seconds (switch apps, browse, type)
8. Click stop or press `⌘S`
9. Confirm end session

### Expected Results
- [ ] Timer displays and counts up
- [ ] Activity feed shows captured screenshots
- [ ] Activity types detected (coding, browsing, etc.)
- [ ] Insights appear in real-time (if activity detected)
- [ ] Final summary generates on stop
- [ ] Summary view shows text, tasks, notes
- [ ] No console errors for bot pipelines

---

## Test 3: Session Recording - Audio Transcription

**Purpose:** Verify audio capture and transcription pipeline.

### Steps
1. Start a new session with microphone enabled
2. Speak for 30+ seconds (describe what you're doing)
3. Wait for audio chunk processing (2 min chunks)
4. Stop session

### Expected Results
- [ ] Audio recording starts without error
- [ ] `audio-chunk` events appear in console
- [ ] Transcript appears in Live Transcript panel
- [ ] Audio content influences final summary
- [ ] Listener removed AFTER backend stops (no race condition)

---

## Test 4: Session Q&A

**Purpose:** Verify Q&A pipeline answers questions about session.

### Steps
1. After completing Test 2 or 3, stay on Summary view
2. Use the chat interface
3. Ask: "What apps did I use?"
4. Ask: "What was I working on?"

### Expected Results
- [ ] Q&A bot responds with relevant information
- [ ] Relevant moments referenced when applicable
- [ ] No hallucinated content
- [ ] Response is concise but helpful

---

## Test 5: Smart Capture Timing

**Purpose:** Verify AI-driven adaptive capture intervals.

### Steps
1. Start session with smart capture enabled (default)
2. Stay on one app doing focused work (30 seconds)
3. Switch apps rapidly (5-6 app switches)
4. Return to focused work

### Expected Results
- [ ] Console shows varying capture intervals
- [ ] Focused work → longer intervals (60-120s)
- [ ] Rapid switching → shorter intervals (15-30s)
- [ ] Activity level reported (high/medium/low)

---

## Test 6: History & Persistence

**Purpose:** Verify sessions persist and are searchable.

### Steps
1. Complete Tests 2-4
2. Navigate to History
3. Verify sessions appear in timeline
4. Use search to find a session by content

### Expected Results
- [ ] All sessions appear in History
- [ ] Timestamps correct
- [ ] Click opens Summary view
- [ ] Search finds matching sessions

---

## Test 7: Settings & API Key Management

**Purpose:** Verify API key configuration works correctly.

### Steps
1. Open Settings
2. Clear Claude API key
3. Save
4. Attempt Quick Capture

### Expected Results
- [ ] Warning shown when no API key
- [ ] Quick Capture fails gracefully with message
- [ ] Re-adding key restores functionality
- [ ] **No API key logged to console** (verify in DevTools)

---

## Test 8: Keyboard Shortcuts

**Purpose:** Verify all shortcuts work.

| Shortcut | Action | Expected |
|----------|--------|----------|
| `⌘K` | Command palette | Opens overlay |
| `⌘N` | New capture | Opens Quick Capture |
| `⇧⌘N` | Start session | Opens Session Recording |
| `⌘H` | Go home | Navigates to Home |
| `Escape` | Close modals | Closes overlays |

---

## Test 9: Error Handling

**Purpose:** Verify graceful failure modes.

### Scenarios
1. **Network failure during capture**
   - Disconnect network, attempt capture
   - [ ] Error message displayed (not crash)

2. **Invalid API key**
   - Enter invalid key in Settings
   - Attempt capture
   - [ ] Authentication error shown

3. **Permission denied**
   - Revoke screen recording permission
   - Attempt session recording
   - [ ] Permission error shown, not crash

---

## Bot Pipeline Verification

Console should show these patterns during a successful session:

```
[Baleybots] AI service configured
Smart capture started
📸 Screenshot captured
[ActivityDetector] hasSignificantChange: true, activityType: coding
[Summarizer] Updated rolling summary
[CaptureTiming] recommendedWaitSeconds: 45, activityLevel: medium
🎤 Audio recording stopped
[FinalSummary] Generated summary with X tasks, Y notes
```

**Red flags (should NOT appear):**
- `Pipeline error` or `Bot error`
- API key visible in logs
- `Unhandled rejection`
- `TypeError` or `undefined`

---

## Sign-off Checklist

Before v1 release:

- [ ] All 9 tests pass
- [ ] No console errors during normal operation
- [ ] No API keys logged
- [ ] Performance acceptable (UI responsive)
- [ ] Final summary quality is good
- [ ] Smart capture adapts correctly

**Tested by:** _________________
**Date:** _________________
**Version:** v1.0.0
