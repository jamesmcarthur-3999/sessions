# Live Session Recording UX Redesign

## Overview

Complete redesign of the session recording experience to be simpler, more magical, and more useful. Eliminates modal popups in favor of inline experiences, removes unnecessary configuration options, and adds a real-time dashboard during recording.

**Design Date**: 2026-02-03
**Status**: Approved for implementation

---

## Design Decisions Summary

| Decision | Choice |
|----------|--------|
| Recording setup | Zoom-style inline picker (no modal) |
| Screen selection | Smart default + multi-select with click-to-toggle |
| Mic selection | Inline dropdown with live level meter |
| Live dashboard | Activity-focused with responsive columns |
| Large screen layout | 60/40 split (Activity+Transcript / Insights) |
| End session | Inline confirmation bar (no modal) |
| Screenshot timing | Removed — always smart/adaptive |
| Analysis mode | Removed — always deep/high-effort |
| Smart capture | Removed — always on |

---

## Part 1: Recording Setup Flow

### Current Problems
- Modal popup interrupts flow
- Too many options (10+ toggles/dropdowns)
- Mic/screen selection doesn't work reliably
- Analysis mode choice confuses users

### New Design

#### 1.1 Starting a Recording (from Home)

**Trigger**: User clicks "Record Session" card on Home screen

**Behavior**: Card expands inline (no modal), revealing setup UI:

```
┌─────────────────────────────────────────────────────────────┐
│  ← Back                                                     │
│                                                             │
│  Select Screen(s) to Record                                 │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐                   │
│  │                 │  │                 │                   │
│  │   Display 1     │  │   Display 2     │                   │
│  │   [thumbnail]   │  │   [thumbnail]   │                   │
│  │       ✓         │  │                 │                   │
│  │  2560×1440      │  │  1920×1080      │                   │
│  └─────────────────┘  └─────────────────┘                   │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  🎤 MacBook Pro Microphone              ▾                   │
│      ▮▮▮▯▯  (live level)                                   │
│                                                             │
│  ☐ Record without audio                                     │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Start Recording                            │   │
│  │     Recording Display 1 with MacBook Microphone      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 1.2 Screen Selection Logic

**Single screen detected**:
- Auto-select it
- Show thumbnail with checkmark (non-interactive)
- Skip directly to mic selection
- Label: "Your screen" instead of "Display 1"

**Multiple screens detected**:
- Show all as thumbnails in a responsive grid
- Primary screen pre-selected with checkmark
- Click to toggle selection on each
- At least one must be selected
- Count shown on Start button: "Record 2 screens"

**Screen thumbnail requirements**:
- Live preview (update every 1-2 seconds) OR static screenshot
- Show resolution below: "2560×1440"
- Show name: "Built-in Display" or "LG UltraFine"
- Checkmark overlay when selected
- Subtle border highlight when selected

#### 1.3 Microphone Selection

**Appears after screen selection (or immediately if single screen)**

**Components**:
- Dropdown showing all available input devices
- Default/system mic pre-selected
- Live audio level meter (4 bars) showing input is working
- "Record without audio" checkbox below

**Dropdown items show**:
- Device name
- "Default" badge if system default
- Checkmark on selected item

#### 1.4 Start Button

**States**:
- Disabled: No screen selected
- Enabled: Shows context text below button

**Context text examples**:
- "Recording Display 1 with MacBook Microphone"
- "Recording 2 screens with MacBook Microphone"
- "Recording Display 1 without audio"

**Action**: Click immediately starts recording, transitions to live session view

#### 1.5 Removed Configuration

These options are **eliminated** — the system handles them automatically:

| Removed Option | New Behavior |
|----------------|--------------|
| Screenshot interval (30s/1m/2m/5m/10m) | Smart capture: on activity + app switches |
| Smart capture toggle | Always on |
| Analysis mode (ambient/deep/adaptive) | Always deep/high-effort analysis |
| Video toggle | Always record video if screen selected |
| Screenshots toggle | Always capture screenshots |
| Audio toggle | Controlled by mic selection + checkbox |

#### 1.6 Animation Specifications

**Card expansion** (Home → Setup):
- Duration: 400ms
- Easing: [0.16, 1, 0.3, 1] (ease-out-expo)
- Card grows to fill available space
- Content fades in staggered (screens → mic → button)
- Stagger delay: 100ms between elements

**Screen thumbnail selection**:
- Checkmark scales in: 200ms
- Border color transition: 150ms
- Subtle scale on hover: 1.02

---

## Part 2: Live Session Dashboard

### Current Problems
- Timer dominates screen, nothing else visible
- Intelligence panel hidden in sidebar (requires ⌘I)
- No real-time activity visibility
- Dark theme feels disconnected from rest of app

### New Design

#### 2.1 Overall Layout

**Structure**: Timer fixed at top, scrollable dashboard below

```
┌─────────────────────────────────────────────────────────────┐
│  TIMER SECTION (fixed)                                      │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│           ● Recording                     [Pause] [Stop]    │
│                                                             │
│               01:23:45                                      │
│                                                             │
│         "Session at 2:45 PM"  ✎                            │
│                                                             │
│      📷 45 shots  🎤 Transcribing...  🎬 Recording          │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  DASHBOARD SECTION (scrollable)                             │
│                                                             │
│  ┌─────────────────────────────┐ ┌────────────────────────┐ │
│  │ ACTIVITY + TRANSCRIPT (60%) │ │ AI INSIGHTS (40%)      │ │
│  │                             │ │                        │ │
│  │ Recent Activity             │ │ Insights               │ │
│  │ ● VS Code opened           │ │ ┌────────────────────┐ │ │
│  │ ● Screenshot captured      │ │ │ You mentioned      │ │ │
│  │ ● "Let me check the..."    │ │ │ needing to follow  │ │ │
│  │ ● Chrome → VS Code switch  │ │ │ up with Sarah...   │ │ │
│  │                             │ │ │           [📌 Pin] │ │ │
│  │ Live Transcript            │ │ └────────────────────┘ │ │
│  │ "...so I think we should   │ │                        │ │
│  │ probably look at the API   │ │ ┌────────────────────┐ │ │
│  │ response first and then    │ │ │ Task detected:     │ │ │
│  │ figure out why it's..."    │ │ │ "Review PR #234"   │ │ │
│  │ [streaming...]             │ │ │           [📌 Pin] │ │ │
│  │                             │ │ └────────────────────┘ │ │
│  └─────────────────────────────┘ └────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 2.2 Responsive Behavior

**Breakpoints**:

| Width | Layout |
|-------|--------|
| < 768px | Single column, sections stacked |
| 768px - 1199px | Single column, wider content |
| ≥ 1200px | Two columns: 60% / 40% split |

**Single column order** (top to bottom):
1. Activity Feed
2. Live Transcript
3. AI Insights

#### 2.3 Timer Section (Fixed Header)

**Always visible at top, doesn't scroll**

**Components**:
- Recording indicator: Red pulsing dot + "Recording" text
- Timer: Large monospace, counts up (00:00:00)
- Session title: Editable inline (click to edit)
- Stats bar: Screenshot count, transcription status, video status
- Controls: Pause button, Stop button

**Timer typography**:
- Font: Monospace (SF Mono / Fira Code)
- Size: 4xl on mobile, 6xl on desktop
- Weight: 300 (light)
- Feature: tabular-nums for stable width

**Stats bar icons**:
- 📷 + count: Screenshots taken
- 🎤 + status: "Transcribing..." / "Listening..." / checkmark
- 🎬 + "Recording": Video status

#### 2.4 Activity Feed

**Purpose**: Show real-time stream of detected events

**Event types**:

| Event | Display |
|-------|---------|
| App switch | "Chrome → VS Code" with app icons |
| Screenshot | "Screenshot captured" with tiny thumbnail |
| Speech detected | First ~50 chars of transcript in quotes |
| Silence period | "Quiet period (2 min)" - subtle/muted |
| AI insight | "💡 Insight generated" - links to insights column |

**Design**:
- Vertical timeline with subtle line connecting events
- Newest at top
- Timestamps on left (relative: "2m ago", "just now")
- Max ~20 items visible, older items fade/collapse
- Subtle animations as new items appear

**Animation**: New items slide in from top, 200ms, slight fade

#### 2.5 Live Transcript

**Purpose**: Show real-time transcription of audio

**States**:

| State | Display |
|-------|---------|
| Listening | Subtle pulse animation, "Listening..." |
| Transcribing | Waveform animation, streaming text |
| No audio | "Audio recording disabled" message |
| Error | "Transcription unavailable" with retry |

**Design**:
- Continuous flowing text
- New text animates in (typing effect or fade)
- Timestamps optional (every 30s?)
- Speaker detection if available: "Speaker 1:", "Speaker 2:"
- Scroll follows latest text (auto-scroll)
- User can scroll up to review (pauses auto-scroll)

**Typography**:
- Font: System sans-serif
- Size: 0.95rem (readable but compact)
- Line height: 1.6
- Color: var(--ink) with var(--ink-muted) for timestamps

#### 2.6 AI Insights Panel

**Purpose**: Show AI-generated insights, tasks, and observations in real-time

**Card types**:

| Type | Appearance |
|------|------------|
| Task detected | Yellow/amber accent, task icon |
| Follow-up needed | Blue accent, reminder icon |
| Key insight | Gold accent, lightbulb icon |
| Summary update | Subtle, document icon |

**Card anatomy**:
```
┌──────────────────────────────────┐
│ 💡 Key Insight           2m ago  │
│ ────────────────────────────────│
│ You discussed the API rate       │
│ limiting issue. Consider adding  │
│ exponential backoff.             │
│                          [📌 Pin]│
└──────────────────────────────────┘
```

**Interactions**:
- Pin button: Saves insight to final summary
- Click card: Expands for full detail (inline, not modal)
- Swipe left (mobile): Quick pin action

**Animation**: Cards slide in from right, 250ms, subtle scale

#### 2.7 Dashboard Section Headings

Each section has a consistent header:

```
┌──────────────────────────────────┐
│ Activity              Show all → │
├──────────────────────────────────┤
│ [content]                        │
```

- Section name: label-section style (small caps, muted)
- Optional action link on right
- Subtle divider line below

---

## Part 3: End Session Flow

### Current Problems
- Modal popup for confirmation
- "End Session?" dialog feels heavy

### New Design

#### 3.1 Inline Confirmation Bar

**Trigger**: User clicks "Stop" button

**Behavior**: Stop button transforms into confirmation bar

**Before** (normal state):
```
[Pause]  [Stop]
```

**After clicking Stop** (confirmation state):
```
┌─────────────────────────────────────────────────────────────┐
│  End session?    [Keep Recording]  [End & Process →]       │
└─────────────────────────────────────────────────────────────┘
```

**Specifications**:
- Bar appears in same location as controls
- Smooth transition: 300ms
- "Keep Recording" = cancel, return to normal state
- "End & Process" = confirm, begin processing
- **Auto-dismiss**: Returns to normal state after 5 seconds if no action
- Countdown indicator: Subtle progress bar or fade

#### 3.2 Processing State

After confirmation, show processing inline (same view):

**Timer section changes**:
- Timer freezes at final time
- Recording indicator → "Processing..." with spinner
- Stats bar → Progress steps

**Dashboard changes**:
- Activity feed → Fades/dims
- Shows processing steps:
  1. "Stopping recording..."
  2. "Processing audio..."
  3. "Generating AI summary..."
  4. "Complete!"

**Animation**: Smooth transition, ~300ms, content cross-fades

---

## Part 4: Component Architecture

### New Components to Create

| Component | Purpose |
|-----------|---------|
| `SessionSetup.tsx` | Inline recording setup (replaces modal) |
| `ScreenPicker.tsx` | Screen thumbnail selection grid |
| `ScreenThumbnail.tsx` | Individual screen preview with selection |
| `MicSelector.tsx` | Microphone dropdown with level meter |
| `AudioLevelMeter.tsx` | Exists, may need updates |
| `LiveDashboard.tsx` | Main dashboard container |
| `ActivityFeed.tsx` | Real-time activity stream |
| `LiveTranscript.tsx` | Streaming transcription display |
| `InsightsPanel.tsx` | AI insights cards |
| `InsightCard.tsx` | Individual insight card |
| `InlineConfirmBar.tsx` | End session confirmation |
| `SessionTimer.tsx` | Extract timer into component |

### Components to Modify

| Component | Changes |
|-----------|---------|
| `Home.tsx` | Remove modal trigger, add inline setup |
| `SessionRecording.tsx` | Major refactor to new dashboard |
| `RecordingSettings.tsx` | DELETE (replaced by SessionSetup) |
| `LiveSessionPanel.tsx` | DELETE (replaced by dashboard) |
| `PeripheralGlow.tsx` | Keep for ambient feedback |

### Components to Delete

- `RecordingSettings.tsx` (731 lines)
- `LiveSessionPanel.tsx` (296 lines)

---

## Part 5: Data Flow & Services

### Screen Capture Service Updates

**Required functionality**:
- `getScreens()`: Already exists, returns ScreenInfo[]
- `getScreenThumbnail(screenId)`: NEW - capture preview image
- `startMultiScreenRecording(screenIds[])`: UPDATE - support array
- Live thumbnail updates during setup (1-2 second refresh)

### Audio Service Updates

**Required functionality**:
- `getAudioDevices()`: Already exists
- `getAudioLevel(deviceId)`: Already exists (AudioLevelMeter uses it)
- Ensure level meter works during setup (before recording starts)

### Session Coordinator Updates

**Required for real-time dashboard**:
- Event: `activity-detected` → Activity Feed
- Event: `transcript-chunk` → Live Transcript
- Event: `insight-created` → Insights Panel
- Always run in "deep" mode (no ambient option)

### Simplified RecordingConfig

**Old config** (10 fields):
```typescript
interface RecordingConfig {
  enableScreenshots: boolean
  enableAudio: boolean
  enableVideo: boolean
  screenshotInterval: number
  selectedMicrophone: string | null
  selectedScreen: string | null
  smartCaptureEnabled: boolean
  analysisMode: 'ambient' | 'deep' | 'adaptive'
}
```

**New config** (3 fields):
```typescript
interface RecordingConfig {
  selectedScreens: string[]  // Array for multi-screen
  selectedMicrophone: string | null  // null = no audio
  // Everything else is automatic/hardcoded
}
```

---

## Part 6: Visual Design Specifications

### Color Usage

| Element | Color |
|---------|-------|
| Recording indicator | var(--session-recording) - red |
| Selected screen border | var(--session-recording) |
| Pause state | var(--accent) - gold |
| Task insight | amber-500 |
| Follow-up insight | blue-500 |
| Key insight | var(--accent) - gold |
| Activity timestamps | var(--ink-muted) |

### Animation Timing

| Animation | Duration | Easing |
|-----------|----------|--------|
| Card expansion | 400ms | [0.16, 1, 0.3, 1] |
| Content fade in | 200ms | ease-out |
| Stagger delay | 100ms | - |
| Selection toggle | 200ms | ease-out |
| New item slide in | 200ms | [0.16, 1, 0.3, 1] |
| Confirmation bar | 300ms | ease-out |

### Spacing System

| Element | Spacing |
|---------|---------|
| Section padding | 24px (p-6) |
| Section gap | 24px (gap-6) |
| Card padding | 16px (p-4) |
| Item gap in lists | 8px (gap-2) |

---

## Part 7: Accessibility

### Keyboard Navigation

| Key | Action |
|-----|--------|
| Space | Toggle screen selection (when focused) |
| Enter | Start recording (when on button) |
| Escape | Cancel setup, return to Home |
| Tab | Navigate between screens, mic, button |
| Space | Pause/resume (during recording) |
| Cmd+Enter | End session (with confirmation) |

### Screen Reader

- Screen thumbnails: "Display 1, 2560 by 1440, selected"
- Audio meter: "Microphone level: moderate"
- Activity items: Read event + timestamp
- Insights: "New insight: [content], pin button"

### Focus Management

- Auto-focus first screen on setup open
- Focus trap within setup UI
- Return focus to trigger on close/cancel

---

## Part 8: Error Handling

### Permission Errors

**No screen recording permission**:
- Show inline message (not modal)
- "Screen recording permission required"
- Button: "Grant Permission" → Opens system preferences
- After granting, auto-refresh screen list

**No microphone permission**:
- Show warning but allow proceeding without audio
- "Microphone access denied. Recording without audio."
- Don't block the flow

### Device Errors

**No screens detected**:
- "No displays found. Please check your connections."
- Retry button to refresh

**No microphones detected**:
- Auto-select "No audio" option
- Note: "No microphones found"

**Screen capture fails during recording**:
- Toast notification (not blocking)
- Continue recording other screens if multi-screen
- Log error for debugging

---

## Implementation Order

### Phase 1: Foundation (Day 1)
1. Create simplified RecordingConfig type
2. Create SessionSetup component (shell)
3. Create ScreenPicker + ScreenThumbnail components
4. Wire up screen detection and selection

### Phase 2: Audio Setup (Day 1-2)
5. Create/update MicSelector component
6. Integrate AudioLevelMeter into setup
7. Add "no audio" toggle
8. Test full setup flow

### Phase 3: Home Integration (Day 2)
9. Modify Home.tsx to use inline setup
10. Delete RecordingSettings.tsx modal
11. Update animations and transitions
12. Test setup → recording transition

### Phase 4: Dashboard Shell (Day 2-3)
13. Create LiveDashboard container
14. Create SessionTimer component (extract from existing)
15. Implement responsive column layout
16. Create section headers and structure

### Phase 5: Activity Feed (Day 3)
17. Create ActivityFeed component
18. Wire up to session coordinator events
19. Implement activity item types
20. Add animations for new items

### Phase 6: Live Transcript (Day 3-4)
21. Create LiveTranscript component
22. Wire up to transcription events
23. Implement auto-scroll behavior
24. Handle states (listening, transcribing, error)

### Phase 7: Insights Panel (Day 4)
25. Create InsightsPanel + InsightCard components
26. Wire up to insight events
27. Implement pin functionality
28. Add card animations

### Phase 8: End Session (Day 4-5)
29. Create InlineConfirmBar component
30. Replace modal confirmation
31. Implement auto-dismiss countdown
32. Wire up to processing flow

### Phase 9: Polish & Cleanup (Day 5)
33. Delete LiveSessionPanel.tsx
34. Delete RecordingSettings.tsx
35. Update all imports and references
36. Full integration testing
37. Fix any visual bugs
38. Performance optimization

---

## Success Criteria

- [ ] No modal popups in entire flow
- [ ] Recording starts in ≤3 clicks
- [ ] Screen/mic selection works reliably
- [ ] Dashboard shows real-time activity
- [ ] Dashboard shows live transcript
- [ ] AI insights appear during recording
- [ ] Multi-screen selection works
- [ ] Responsive layout works at all sizes
- [ ] All animations smooth (60fps)
- [ ] Accessibility: keyboard navigable
- [ ] Error states handled gracefully
