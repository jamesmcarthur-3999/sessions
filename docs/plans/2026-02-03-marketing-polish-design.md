# Marketing Polish Design

**Date**: February 3, 2026
**Status**: Approved
**Scope**: Comprehensive UI/UX polish for real-world launch

---

## Overview

Sessions is at 8.5/10 quality. This design covers the remaining polish to reach launch-ready state:

1. **Design system consistency** — Fix components using hardcoded Tailwind colors
2. **Copy refinement** — Editorial voice: minimal, sophisticated, assumes intelligence
3. **Onboarding** — Hybrid approach: welcome modal + contextual hints + help tooltips
4. **Wow factor** — Subtle animations and celebratory moments

---

## 1. Design System Consistency

### Problem

Three components use Tailwind's `neutral-*` grays instead of CSS variables:
- `Settings.tsx`
- `History.tsx`
- `CommandPalette.tsx`

This creates visual discontinuity with the rest of the app.

### Solution

Migrate all hardcoded Tailwind colors to CSS variables:

| Tailwind | CSS Variable |
|----------|--------------|
| `bg-neutral-50` | `bg-[var(--paper)]` |
| `bg-neutral-100` | `bg-[var(--paper-warm)]` |
| `bg-neutral-200` | `bg-[var(--paper-dark)]` |
| `bg-neutral-800`, `bg-neutral-900` | `bg-[var(--ink)]` |
| `bg-neutral-950` | `bg-[var(--ink)]` |
| `text-neutral-500` | `text-[var(--ink-muted)]` |
| `text-neutral-900`, `text-neutral-100` | `text-[var(--ink)]` |
| `border-neutral-200`, `border-neutral-800` | `border-[var(--border-subtle)]` |
| `dark:bg-neutral-*` | Remove (CSS variables handle dark mode) |
| `dark:text-neutral-*` | Remove (CSS variables handle dark mode) |

### Settings-Specific Changes

Replace Tailwind feature colors with app semantic palette:

| Current | Replace With |
|---------|--------------|
| `bg-violet-500`, `text-violet-*` | `var(--accent)` |
| `bg-amber-*`, `text-amber-*` | `var(--accent)` with opacity |
| `bg-green-*`, `text-green-*` | `var(--success)` |
| `bg-blue-*`, `text-blue-*` | `var(--capture-blue)` |

---

## 2. Copy Refinement

### Voice Principle

Editorial & refined. Minimal words, maximum meaning. Assume intelligence.

### Home Screen

| Current | Refined |
|---------|---------|
| "Record a Session" | "Record Session" |
| "Capture your screen and audio as you work" | "Screen, audio, and insights — captured as you work" |
| "Quick Capture" | "Quick Capture" *(unchanged)* |
| "Paste text, drop a file, or type your thoughts" | "Text, files, or thoughts — distilled in seconds" |
| "Configure Claude API for intelligent summaries →" | "Add your API key to unlock AI →" |

### Settings Screen

| Current | Refined |
|---------|---------|
| "Power Up with AI" | "Intelligence" |
| "Connect your Claude API key to unlock intelligent summaries, task extraction, and smart chat features." | "API keys enable summaries, task extraction, and chat." |
| "What You'll Unlock" | "Capabilities" |

### Recording Settings

| Current | Refined |
|---------|---------|
| "Recording Settings" | "Configure Recording" |
| "Configure capture options" | "Choose what to capture" |
| "Capture screen at intervals" | "Periodic screenshots" |
| "Record microphone input" | "Audio transcription" |
| "Record screen as video" | "Screen recording" |
| "Enable at least one capture mode to start recording" | "Select at least one capture mode" |

### Processing States

Keep unchanged — already excellent:
- "Reading your thoughts..."
- "Extracting insights..."
- "Crafting your summary..."

---

## 3. Onboarding (Hybrid Approach)

Three layers working together for progressive discovery.

### Layer 1: Welcome Modal

**Trigger**: First app launch (check `localStorage.sessions_onboarding_complete`)

**Design**:
```
┌─────────────────────────────────────────┐
│                                         │
│            [Sessions Logo]              │
│                                         │
│         Your work, distilled.           │
│                                         │
│   Sessions captures what you do and     │
│   transforms it into clear summaries,   │
│   tasks, and insights.                  │
│                                         │
│   ┌───────────────┬─────────────────┐   │
│   │  Add API Key  │   Get Started   │   │
│   └───────────────┴─────────────────┘   │
│                                         │
│         ⌘K opens command palette        │
│                                         │
└─────────────────────────────────────────┘
```

**Behavior**:
- "Add API Key" → navigates to Settings, sets onboarding complete
- "Get Started" → dismisses modal, sets onboarding complete
- Modal uses same animation pattern as other modals (fade + scale)

**Storage**: `localStorage.setItem('sessions_onboarding_complete', 'true')`

### Layer 2: Contextual Hints

**Trigger**: Features user hasn't tried yet

**Design**: Pulsing gold dot (8px) positioned at top-right of feature element

**Hints**:

| Location | Element | Hint Text | Dismiss Trigger |
|----------|---------|-----------|-----------------|
| Home | "Record Session" card | — (just pulse, no text) | First session started |
| Recording Settings | Smart Capture toggle | "Captures on app switches" | Toggle interacted |
| Summary View | Chat input | "Ask about this session" | First message sent |

**Storage**: `localStorage.sessions_hints` as JSON object tracking dismissed hints

**Animation**:
```css
@keyframes hint-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.5); opacity: 0.7; }
}
```

### Layer 3: Help Tooltips

**Design**: Small `(?)` icon (14px, `--ink-muted` color) next to complex features. On hover, shows tooltip.

**Tooltip Locations & Content**:

| Feature | Tooltip Text |
|---------|--------------|
| Smart Capture | "Automatically captures when you switch apps or after periods of activity" |
| Analysis Mode: Adaptive | "AI adjusts analysis depth based on your activity" |
| Analysis Mode: Ambient | "Light analysis, minimal resource usage" |
| Analysis Mode: Deep | "Continuous analysis, real-time insights" |
| Claude API Key | "Stored locally. Never sent to our servers." |
| OpenAI API Key | "Stored locally. Used only for audio transcription." |

**Tooltip Component**:
```tsx
interface TooltipProps {
  content: string
  children: React.ReactNode
}
```

**Behavior**:
- Show on hover (desktop) or tap (mobile)
- Position: prefer top, fall back to bottom if no space
- Delay: 200ms before showing
- Animation: fade in (150ms)

---

## 4. Wow Factor (Animations & Delight)

### Celebratory Moments

#### 4.1 API Key Success

**Trigger**: `testApiKey()` returns valid

**Animation**:
1. Button shows success state (checkmark)
2. Golden shimmer radiates outward from button (400ms)
3. Toast appears: "Intelligence unlocked" with sparkle icon

**Implementation**: CSS radial gradient animation + Toast component

#### 4.2 First Session Confetti

**Trigger**: First session processing completes (check `localStorage.sessions_first_session_complete`)

**Animation**:
1. Processing spinner completes
2. Gold particle burst (15-20 small dots) drifts down (1.5s)
3. Summary fades in as particles fade out

**Implementation**: Canvas or CSS-based particle system, fires once ever

**Storage**: `localStorage.setItem('sessions_first_session_complete', 'true')`

#### 4.3 Task Strikethrough

**Trigger**: Task checkbox clicked

**Animation**:
1. Strikethrough line animates left-to-right across task text (200ms)
2. Existing scale pop `[1, 1.3, 1]` plays
3. Task text fades to `--ink-muted` (150ms)

#### 4.4 Session Saved Indicator

**Trigger**: Session saved to database after processing

**Animation**:
1. Small checkmark + "Saved" text fades in at top of Summary View
2. Holds for 2 seconds
3. Fades out

### Enhanced Micro-Interactions

#### 4.5 Audio-Reactive Recording Pulse

**Current**: Red dot pulses at fixed rate

**Enhancement**: Pulse intensity scales with `audioLevel` state (already available)

```tsx
animate={{
  scale: isPaused ? 1 : [1, 1.1 + audioLevel * 0.2, 1],
  opacity: isPaused ? 0.5 : [1, 0.7, 1]
}}
```

#### 4.6 Screenshot Capture Confirmation

**Trigger**: `smartCapture.on('capture')` event

**Current**: Screen flash effect

**Enhancement**: Add camera shutter icon that appears briefly at bottom-right

**Animation**:
1. Camera icon fades in + slight scale up (100ms)
2. Hold (50ms)
3. Fade out (100ms)

#### 4.7 Chat Typing Indicator

**Trigger**: User sends message, before AI response arrives

**Animation**: Three dots pulsing in sequence (standard typing indicator)

**Duration**: Show for 300ms minimum, then stream in response

**Implementation**: Add `isTyping` state to chat, show indicator between send and first response token

#### 4.8 Consistent Hover/Press States

**Audit and ensure**:
- All clickable cards: `whileHover={{ y: -2 }}` with `transition={{ duration: 0.2 }}`
- All buttons: `whileTap={{ scale: 0.98 }}`
- All toggles: smooth thumb animation (already implemented)

---

## 5. Implementation Order

### Phase 1: Foundation (3-4 hours)
1. Design system migration (Settings, History, CommandPalette)
2. Copy refinement (all string changes)

### Phase 2: Onboarding (4-5 hours)
3. Welcome modal component
4. Contextual hints system
5. Help tooltip component

### Phase 3: Delight (4-5 hours)
6. API key success animation
7. First session confetti
8. Task strikethrough enhancement
9. Session saved indicator
10. Audio-reactive pulse
11. Screenshot capture icon
12. Chat typing indicator
13. Hover state audit

### Total Estimated Effort: 12-15 hours

---

## 6. Files to Modify

### Design System
- `src/components/Settings.tsx` — color migration + copy
- `src/components/History.tsx` — color migration
- `src/components/CommandPalette.tsx` — color migration

### Copy
- `src/components/Home.tsx` — headlines and descriptions
- `src/components/RecordingSettings.tsx` — labels and descriptions

### New Components
- `src/components/WelcomeModal.tsx` — first-run modal
- `src/components/ContextualHint.tsx` — pulsing hint dots
- `src/components/Tooltip.tsx` — help tooltips
- `src/components/TypingIndicator.tsx` — chat typing dots
- `src/components/Confetti.tsx` — first session celebration

### Enhanced Components
- `src/components/SessionRecording.tsx` — audio-reactive pulse, capture icon
- `src/components/SummaryView.tsx` — saved indicator, task animation, typing indicator
- `src/components/Toast.tsx` — shimmer variant for API success

### Context/State
- `src/context/AppContext.tsx` — onboarding state, hints state

---

## 7. Success Criteria

- [ ] All screens use CSS variables exclusively (no Tailwind grays)
- [ ] Settings page feels cohesive with rest of app
- [ ] New users understand value prop within 10 seconds
- [ ] Smart Capture and Analysis Modes are explained via tooltips
- [ ] First session completion feels rewarding
- [ ] API key configuration has clear success feedback
- [ ] All clickable elements have consistent hover/press states
