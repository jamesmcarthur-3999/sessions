# Marketing Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform Sessions from 8.5/10 to launch-ready by fixing design inconsistencies, refining copy, adding onboarding, and enhancing animations.

**Architecture:** Migrate hardcoded Tailwind colors to CSS variables for consistency, add localStorage-based onboarding state, create reusable tooltip/hint components, enhance existing animations with audio-reactive and celebratory effects.

**Tech Stack:** React 19, Tailwind CSS v4, Framer Motion, CSS variables, localStorage

---

## Phase 1: Design System Consistency

### Task 1: Migrate History.tsx to CSS Variables

**Files:**
- Modify: `src/components/History.tsx`

**Step 1: Replace background colors**

Replace all `bg-neutral-*` and `dark:bg-neutral-*` classes:

```tsx
// OLD
className="min-h-screen bg-neutral-50 dark:bg-neutral-950"
// NEW
className="min-h-screen bg-[var(--paper)]"

// OLD
className="bg-neutral-50/80 dark:bg-neutral-950/80"
// NEW
className="bg-[var(--paper)]/80"

// OLD
className="bg-white dark:bg-neutral-900"
// NEW
className="bg-[var(--paper)]"

// OLD
className="bg-neutral-100 dark:bg-neutral-800"
// NEW
className="bg-[var(--paper-warm)]"
```

**Step 2: Replace text colors**

```tsx
// OLD
className="text-neutral-900 dark:text-neutral-100"
// NEW
className="text-[var(--ink)]"

// OLD
className="text-neutral-500"
// NEW
className="text-[var(--ink-muted)]"

// OLD
className="text-neutral-400"
// NEW
className="text-[var(--ink-muted)]"
```

**Step 3: Replace border colors**

```tsx
// OLD
className="border-neutral-200 dark:border-neutral-800"
// NEW
className="border-[var(--border-subtle)]"
```

**Step 4: Replace hover states**

```tsx
// OLD
className="hover:text-neutral-900 dark:hover:text-neutral-100"
// NEW
className="hover:text-[var(--ink)]"

// OLD
className="hover:bg-neutral-100 dark:hover:bg-neutral-800"
// NEW
className="hover:bg-[var(--paper-warm)]"
```

**Step 5: Verify visually**

Run: `npm run dev`
Check: History page in both light and dark mode

**Step 6: Commit**

```bash
git add src/components/History.tsx
git commit -m "refactor(History): migrate from Tailwind grays to CSS variables"
```

---

### Task 2: Migrate CommandPalette.tsx to CSS Variables

**Files:**
- Modify: `src/components/CommandPalette.tsx`

**Step 1: Replace overlay background**

```tsx
// OLD
className="fixed inset-0 bg-black/50"
// NEW
className="fixed inset-0 bg-[var(--ink)]/50"
```

**Step 2: Replace modal background and border**

```tsx
// OLD
className="bg-neutral-900 border-neutral-700"
// or
className="bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700"
// NEW
className="bg-[var(--paper)] border-[var(--border-subtle)]"
```

**Step 3: Replace input styling**

```tsx
// OLD
className="bg-transparent text-neutral-100 placeholder:text-neutral-500"
// or
className="text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400"
// NEW
className="bg-transparent text-[var(--ink)] placeholder:text-[var(--ink-muted)]"
```

**Step 4: Replace item styling**

```tsx
// OLD (selected state)
className="bg-neutral-800"
// or
className="bg-neutral-100 dark:bg-neutral-800"
// NEW
className="bg-[var(--paper-warm)]"

// OLD (text)
className="text-neutral-100"
// NEW
className="text-[var(--ink)]"

// OLD (description)
className="text-neutral-400"
// NEW
className="text-[var(--ink-muted)]"
```

**Step 5: Replace shortcut badge styling**

```tsx
// OLD
className="bg-neutral-700 text-neutral-300"
// or
className="bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-300"
// NEW
className="bg-[var(--paper-dark)] text-[var(--ink-muted)]"
```

**Step 6: Verify visually**

Run: `npm run dev`
Check: Press ⌘K in both light and dark mode

**Step 7: Commit**

```bash
git add src/components/CommandPalette.tsx
git commit -m "refactor(CommandPalette): migrate from Tailwind grays to CSS variables"
```

---

### Task 3: Migrate Settings.tsx to CSS Variables

**Files:**
- Modify: `src/components/Settings.tsx`

**Step 1: Replace header background and border**

```tsx
// OLD
className="bg-neutral-50/80 dark:bg-neutral-950/80 border-b border-neutral-200 dark:border-neutral-800"
// NEW
className="bg-[var(--paper)]/80 border-b border-[var(--border-subtle)]"
```

**Step 2: Replace back button styling**

```tsx
// OLD
className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
// NEW
className="text-[var(--ink-muted)] hover:text-[var(--ink)]"
```

**Step 3: Replace title text**

```tsx
// OLD
className="text-neutral-900 dark:text-neutral-100"
// NEW
className="text-[var(--ink)]"
```

**Step 4: Replace hero gradient**

```tsx
// OLD
className="bg-gradient-to-br from-violet-500 to-purple-600"
// NEW
className="bg-[var(--accent)]"
```

**Step 5: Replace card backgrounds and borders**

```tsx
// OLD
className="border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900"
// NEW
className="border-[var(--border-subtle)] bg-[var(--paper)]"
```

**Step 6: Replace icon containers**

```tsx
// OLD (amber)
className="bg-amber-100 dark:bg-amber-900/30"
// NEW
className="bg-[var(--accent)]/10"

// OLD (green)
className="bg-green-100 dark:bg-green-900/30"
// NEW
className="bg-[var(--success)]/10"

// OLD (violet)
className="bg-violet-100 dark:bg-violet-900/30"
// NEW
className="bg-[var(--accent)]/10"

// OLD (blue)
className="bg-blue-100 dark:bg-blue-900/30"
// NEW
className="bg-[var(--capture-blue)]/10"
```

**Step 7: Replace icon colors**

```tsx
// OLD
className="text-amber-600 dark:text-amber-400"
// NEW
className="text-[var(--accent)]"

// OLD
className="text-green-600 dark:text-green-400"
// NEW
className="text-[var(--success)]"

// OLD
className="text-violet-500"
// NEW
className="text-[var(--accent)]"

// OLD
className="text-blue-500"
// NEW
className="text-[var(--capture-blue)]"
```

**Step 8: Replace input styling**

```tsx
// OLD
className="border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400"
// NEW
className="border-[var(--border-subtle)] bg-[var(--paper-warm)] text-[var(--ink)] placeholder:text-[var(--ink-muted)]"

// OLD (focus)
className="focus:ring-violet-500"
// NEW
className="focus:ring-[var(--accent)]"
```

**Step 9: Replace button styling**

```tsx
// OLD
className="bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200"
// NEW
className="bg-[var(--ink)] text-[var(--paper)] hover:opacity-90"

// OLD (secondary button)
className="border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
// NEW
className="border-[var(--border-subtle)] hover:bg-[var(--paper-warm)]"
```

**Step 10: Replace link color**

```tsx
// OLD
className="text-violet-600 dark:text-violet-400"
// NEW
className="text-[var(--accent)]"
```

**Step 11: Replace footer text**

```tsx
// OLD
className="text-neutral-400"
// NEW
className="text-[var(--ink-muted)]"
```

**Step 12: Replace section header**

```tsx
// OLD
className="text-neutral-500 dark:text-neutral-400"
// NEW
className="text-[var(--ink-muted)]"
```

**Step 13: Verify visually**

Run: `npm run dev`
Check: Settings page in both light and dark mode

**Step 14: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "refactor(Settings): migrate from Tailwind colors to CSS variables"
```

---

## Phase 2: Copy Refinement

### Task 4: Update Settings.tsx Copy

**Files:**
- Modify: `src/components/Settings.tsx`

**Step 1: Update hero section**

```tsx
// OLD
<h2>Power Up with AI</h2>
// NEW
<h2>Intelligence</h2>

// OLD
<p>Connect your Claude API key to unlock intelligent summaries, task extraction, and smart chat features.</p>
// NEW
<p>API keys enable summaries, task extraction, and chat.</p>
```

**Step 2: Update section header**

```tsx
// OLD
<h3>What You'll Unlock</h3>
// NEW
<h3>Capabilities</h3>
```

**Step 3: Verify visually**

Run: `npm run dev`
Check: Settings page text

**Step 4: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "copy(Settings): refine to editorial voice"
```

---

### Task 5: Update Home.tsx Copy

**Files:**
- Modify: `src/components/Home.tsx`

**Step 1: Update session recording card**

```tsx
// OLD
title: "Record a Session"
description: "Capture your screen and audio as you work"
// NEW
title: "Record Session"
description: "Screen, audio, and insights — captured as you work"
```

**Step 2: Update quick capture card**

```tsx
// OLD
description: "Paste text, drop a file, or type your thoughts"
// NEW
description: "Text, files, or thoughts — distilled in seconds"
```

**Step 3: Update API key prompt (if exists)**

```tsx
// OLD
"Configure Claude API for intelligent summaries →"
// NEW
"Add your API key to unlock AI →"
```

**Step 4: Verify visually**

Run: `npm run dev`
Check: Home page text

**Step 5: Commit**

```bash
git add src/components/Home.tsx
git commit -m "copy(Home): refine to editorial voice"
```

---

### Task 6: Update RecordingSettings.tsx Copy

**Files:**
- Modify: `src/components/RecordingSettings.tsx`

**Step 1: Update header**

```tsx
// OLD
title: "Recording Settings"
subtitle: "Configure capture options"
// NEW
title: "Configure Recording"
subtitle: "Choose what to capture"
```

**Step 2: Update capture mode labels**

```tsx
// OLD
"Capture screen at intervals"
// NEW
"Periodic screenshots"

// OLD
"Record microphone input"
// NEW
"Audio transcription"

// OLD
"Record screen as video"
// NEW
"Screen recording"
```

**Step 3: Update validation message**

```tsx
// OLD
"Enable at least one capture mode to start recording"
// NEW
"Select at least one capture mode"
```

**Step 4: Verify visually**

Run: `npm run dev`
Check: Recording settings text

**Step 5: Commit**

```bash
git add src/components/RecordingSettings.tsx
git commit -m "copy(RecordingSettings): refine to editorial voice"
```

---

## Phase 3: Onboarding - Welcome Modal

### Task 7: Create WelcomeModal Component

**Files:**
- Create: `src/components/WelcomeModal.tsx`

**Step 1: Create the component**

```tsx
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles } from 'lucide-react'

interface WelcomeModalProps {
  isOpen: boolean
  onAddApiKey: () => void
  onGetStarted: () => void
}

export function WelcomeModal({ isOpen, onAddApiKey, onGetStarted }: WelcomeModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[var(--ink)]/50 backdrop-blur-sm z-50"
            onClick={onGetStarted}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div
              className="bg-[var(--paper)] rounded-2xl shadow-2xl max-w-md w-full p-8 text-center"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Logo */}
              <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-[var(--accent)] flex items-center justify-center">
                <Sparkles className="w-8 h-8 text-white" />
              </div>

              {/* Tagline */}
              <h1 className="text-2xl font-semibold text-[var(--ink)] mb-3">
                Your work, distilled.
              </h1>

              {/* Description */}
              <p className="text-[var(--ink-muted)] mb-8">
                Sessions captures what you do and transforms it into clear summaries, tasks, and insights.
              </p>

              {/* Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={onAddApiKey}
                  className="flex-1 px-4 py-3 rounded-xl border border-[var(--border-subtle)] text-[var(--ink)] hover:bg-[var(--paper-warm)] transition-colors"
                >
                  Add API Key
                </button>
                <button
                  onClick={onGetStarted}
                  className="flex-1 px-4 py-3 rounded-xl bg-[var(--ink)] text-[var(--paper)] hover:opacity-90 transition-opacity"
                >
                  Get Started
                </button>
              </div>

              {/* Hint */}
              <p className="text-sm text-[var(--ink-muted)] mt-6">
                <kbd className="px-1.5 py-0.5 rounded bg-[var(--paper-warm)] text-xs font-mono">⌘K</kbd>
                {' '}opens command palette
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
```

**Step 2: Verify component renders**

Run: `npm run dev`
Temporarily render in App.tsx to verify styling

**Step 3: Commit**

```bash
git add src/components/WelcomeModal.tsx
git commit -m "feat(WelcomeModal): create first-run onboarding modal"
```

---

### Task 8: Integrate WelcomeModal into App

**Files:**
- Modify: `src/App.tsx`

**Step 1: Add state for onboarding**

```tsx
const [showWelcome, setShowWelcome] = useState(() => {
  return !localStorage.getItem('sessions_onboarding_complete')
})
```

**Step 2: Add handlers**

```tsx
const handleAddApiKey = () => {
  localStorage.setItem('sessions_onboarding_complete', 'true')
  setShowWelcome(false)
  // Navigate to settings
  setCurrentView('settings')
}

const handleGetStarted = () => {
  localStorage.setItem('sessions_onboarding_complete', 'true')
  setShowWelcome(false)
}
```

**Step 3: Render modal**

```tsx
import { WelcomeModal } from './components/WelcomeModal'

// In JSX, at root level:
<WelcomeModal
  isOpen={showWelcome}
  onAddApiKey={handleAddApiKey}
  onGetStarted={handleGetStarted}
/>
```

**Step 4: Verify**

Run: `npm run dev`
Clear localStorage: `localStorage.removeItem('sessions_onboarding_complete')`
Refresh - modal should appear
Click "Get Started" - modal dismisses, doesn't return on refresh

**Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(App): integrate WelcomeModal for first-run experience"
```

---

## Phase 4: Onboarding - Help Tooltips

### Task 9: Create Tooltip Component

**Files:**
- Create: `src/components/Tooltip.tsx`

**Step 1: Create the component**

```tsx
import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { HelpCircle } from 'lucide-react'

interface TooltipProps {
  content: string
  children?: React.ReactNode
}

export function Tooltip({ content, children }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [position, setPosition] = useState<'top' | 'bottom'>('top')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isVisible && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      // If not enough space above, show below
      setPosition(rect.top < 60 ? 'bottom' : 'top')
    }
  }, [isVisible])

  return (
    <span className="relative inline-flex items-center">
      {children}
      <button
        ref={triggerRef}
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        onClick={() => setIsVisible(!isVisible)}
        className="ml-1 text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors"
        aria-label="Help"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>

      <AnimatePresence>
        {isVisible && (
          <motion.div
            ref={tooltipRef}
            initial={{ opacity: 0, y: position === 'top' ? 4 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={`absolute z-50 px-3 py-2 text-sm rounded-lg bg-[var(--ink)] text-[var(--paper)] shadow-lg max-w-xs whitespace-normal ${
              position === 'top'
                ? 'bottom-full mb-2'
                : 'top-full mt-2'
            } left-1/2 -translate-x-1/2`}
          >
            {content}
            {/* Arrow */}
            <div
              className={`absolute left-1/2 -translate-x-1/2 w-2 h-2 bg-[var(--ink)] rotate-45 ${
                position === 'top'
                  ? 'bottom-0 translate-y-1/2'
                  : 'top-0 -translate-y-1/2'
              }`}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  )
}
```

**Step 2: Verify component**

Run: `npm run dev`
Temporarily add to a page to test hover behavior

**Step 3: Commit**

```bash
git add src/components/Tooltip.tsx
git commit -m "feat(Tooltip): create help tooltip component"
```

---

### Task 10: Add Tooltips to Settings.tsx

**Files:**
- Modify: `src/components/Settings.tsx`

**Step 1: Import Tooltip**

```tsx
import { Tooltip } from './Tooltip'
```

**Step 2: Add tooltip to Claude API Key section**

```tsx
// Around the label "Claude API Key"
<h3 className="font-medium text-[var(--ink)]">
  Claude API Key
  <Tooltip content="Stored locally. Never sent to our servers." />
</h3>
```

**Step 3: Add tooltip to OpenAI API Key section**

```tsx
<h3 className="font-medium text-[var(--ink)]">
  OpenAI API Key
  <Tooltip content="Stored locally. Used only for audio transcription." />
</h3>
```

**Step 4: Verify tooltips**

Run: `npm run dev`
Hover over (?) icons - tooltips should appear

**Step 5: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "feat(Settings): add help tooltips to API key sections"
```

---

### Task 11: Add Tooltips to RecordingSettings.tsx

**Files:**
- Modify: `src/components/RecordingSettings.tsx`

**Step 1: Import Tooltip**

```tsx
import { Tooltip } from './Tooltip'
```

**Step 2: Add tooltip to Smart Capture toggle**

```tsx
// Next to "Smart Capture" label
<span>Smart Capture</span>
<Tooltip content="Automatically captures when you switch apps or after periods of activity" />
```

**Step 3: Add tooltips to Analysis Mode options (if they exist)**

```tsx
// Adaptive
<Tooltip content="AI adjusts analysis depth based on your activity" />

// Ambient
<Tooltip content="Light analysis, minimal resource usage" />

// Deep
<Tooltip content="Continuous analysis, real-time insights" />
```

**Step 4: Verify tooltips**

Run: `npm run dev`
Open recording settings, hover over (?) icons

**Step 5: Commit**

```bash
git add src/components/RecordingSettings.tsx
git commit -m "feat(RecordingSettings): add help tooltips"
```

---

## Phase 5: Wow Factor - Animations

### Task 12: Enhance API Key Success Animation

**Files:**
- Modify: `src/components/Settings.tsx`

**Step 1: Add shimmer animation CSS**

In Settings.tsx, add CSS-in-JS or a style tag:

```tsx
// At top of file or in a useEffect
const shimmerKeyframes = `
@keyframes shimmer {
  0% { background-position: -200% center; }
  100% { background-position: 200% center; }
}
`
```

**Step 2: Update test success state**

```tsx
// When testStatus === 'success', add shimmer effect to button
{testStatus === 'success' && (
  <motion.div
    initial={{ scale: 0.8, opacity: 0 }}
    animate={{ scale: 1, opacity: 1 }}
    className="absolute inset-0 rounded-xl bg-gradient-to-r from-transparent via-[var(--accent)]/20 to-transparent animate-shimmer"
    style={{ backgroundSize: '200% 100%' }}
  />
)}
```

**Step 3: Add toast notification**

When API key validates successfully:

```tsx
if (result.valid) {
  setTestStatus('success')
  // Show toast
  toast.success('Intelligence unlocked', { icon: '✨' })
}
```

**Step 4: Verify animation**

Run: `npm run dev`
Enter valid API key, click Test Connection
Button should shimmer on success

**Step 5: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "feat(Settings): add shimmer animation on API key success"
```

---

### Task 13: Add Audio-Reactive Recording Pulse

**Files:**
- Modify: `src/components/SessionRecording.tsx`

**Step 1: Find the recording indicator pulse**

Look for the red dot animation that pulses during recording.

**Step 2: Update pulse to use audioLevel**

```tsx
// Replace fixed pulse with audio-reactive
<motion.div
  animate={{
    scale: isPaused ? 1 : [1, 1.1 + (audioLevel ?? 0) * 0.2, 1],
    opacity: isPaused ? 0.5 : [1, 0.7, 1]
  }}
  transition={{
    duration: 1,
    repeat: Infinity,
    ease: "easeInOut"
  }}
  className="w-3 h-3 rounded-full bg-red-500"
/>
```

**Step 3: Verify animation**

Run: `npm run tauri dev`
Start recording with microphone
Speak - pulse should react to audio level

**Step 4: Commit**

```bash
git add src/components/SessionRecording.tsx
git commit -m "feat(SessionRecording): add audio-reactive pulse animation"
```

---

### Task 14: Add Session Saved Indicator

**Files:**
- Modify: `src/components/SummaryView.tsx`

**Step 1: Add saved state**

```tsx
const [showSaved, setShowSaved] = useState(false)

// When session saves successfully
useEffect(() => {
  if (session?.id && summary) {
    setShowSaved(true)
    const timer = setTimeout(() => setShowSaved(false), 2000)
    return () => clearTimeout(timer)
  }
}, [session?.id, summary])
```

**Step 2: Add saved indicator UI**

```tsx
<AnimatePresence>
  {showSaved && (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex items-center gap-2 text-sm text-[var(--success)]"
    >
      <Check className="w-4 h-4" />
      <span>Saved</span>
    </motion.div>
  )}
</AnimatePresence>
```

**Step 3: Verify**

Run: `npm run dev`
Complete a session, saved indicator should appear briefly

**Step 4: Commit**

```bash
git add src/components/SummaryView.tsx
git commit -m "feat(SummaryView): add session saved indicator"
```

---

### Task 15: Add Chat Typing Indicator

**Files:**
- Create: `src/components/TypingIndicator.tsx`
- Modify: `src/components/SummaryView.tsx`

**Step 1: Create TypingIndicator component**

```tsx
import { motion } from 'framer-motion'

export function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-4 py-2">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          animate={{
            y: [0, -4, 0],
            opacity: [0.4, 1, 0.4]
          }}
          transition={{
            duration: 0.6,
            repeat: Infinity,
            delay: i * 0.15
          }}
          className="w-2 h-2 rounded-full bg-[var(--ink-muted)]"
        />
      ))}
    </div>
  )
}
```

**Step 2: Add to SummaryView chat**

```tsx
import { TypingIndicator } from './TypingIndicator'

// In chat section, when waiting for response:
{isWaitingForResponse && <TypingIndicator />}
```

**Step 3: Track waiting state**

```tsx
const [isWaitingForResponse, setIsWaitingForResponse] = useState(false)

// When sending message:
setIsWaitingForResponse(true)
// When response arrives:
setIsWaitingForResponse(false)
```

**Step 4: Verify**

Run: `npm run dev`
Send chat message, typing indicator should appear

**Step 5: Commit**

```bash
git add src/components/TypingIndicator.tsx src/components/SummaryView.tsx
git commit -m "feat(chat): add typing indicator while waiting for AI response"
```

---

### Task 16: Audit and Fix Hover States

**Files:**
- Modify: Various component files

**Step 1: Audit clickable elements**

Check these files for consistent hover/tap states:
- `Home.tsx` - action cards
- `History.tsx` - session items
- `Settings.tsx` - buttons
- `CommandPalette.tsx` - items

**Step 2: Add whileHover to cards**

```tsx
<motion.div
  whileHover={{ y: -2 }}
  transition={{ duration: 0.2 }}
  className="..."
>
```

**Step 3: Add whileTap to buttons**

```tsx
<motion.button
  whileTap={{ scale: 0.98 }}
  className="..."
>
```

**Step 4: Verify all interactions**

Run: `npm run dev`
Test hover and click states on all interactive elements

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): ensure consistent hover and tap states across all interactive elements"
```

---

## Phase 6: Onboarding - Contextual Hints

### Task 17: Create ContextualHint Component

**Files:**
- Create: `src/components/ContextualHint.tsx`

**Step 1: Create the component**

```tsx
import { motion } from 'framer-motion'

interface ContextualHintProps {
  id: string
  children: React.ReactNode
}

export function ContextualHint({ id, children }: ContextualHintProps) {
  const hints = JSON.parse(localStorage.getItem('sessions_hints') || '{}')
  const isDismissed = hints[id]

  if (isDismissed) {
    return <>{children}</>
  }

  return (
    <div className="relative">
      {children}
      <motion.div
        animate={{
          scale: [1, 1.5, 1],
          opacity: [1, 0.7, 1]
        }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: "easeInOut"
        }}
        className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[var(--accent)]"
      />
    </div>
  )
}

export function dismissHint(id: string) {
  const hints = JSON.parse(localStorage.getItem('sessions_hints') || '{}')
  hints[id] = true
  localStorage.setItem('sessions_hints', JSON.stringify(hints))
}
```

**Step 2: Commit**

```bash
git add src/components/ContextualHint.tsx
git commit -m "feat(ContextualHint): create pulsing hint dot component"
```

---

### Task 18: Add Hint to Record Session Card

**Files:**
- Modify: `src/components/Home.tsx`

**Step 1: Import ContextualHint**

```tsx
import { ContextualHint, dismissHint } from './ContextualHint'
```

**Step 2: Wrap Record Session card**

```tsx
<ContextualHint id="record-session">
  <motion.div className="...">
    {/* Record Session card content */}
  </motion.div>
</ContextualHint>
```

**Step 3: Dismiss on first session start**

When user starts recording:
```tsx
dismissHint('record-session')
```

**Step 4: Verify**

Run: `npm run dev`
Pulsing dot should appear on Record Session card
Start a session - dot should not reappear

**Step 5: Commit**

```bash
git add src/components/Home.tsx
git commit -m "feat(Home): add contextual hint to Record Session card"
```

---

## Final Task: Verification

### Task 19: Full Visual Regression Check

**Step 1: Clear all localStorage**

```javascript
localStorage.clear()
```

**Step 2: Test first-run experience**

- [ ] Welcome modal appears
- [ ] "Get Started" dismisses modal
- [ ] Modal doesn't reappear on refresh

**Step 3: Test design consistency**

- [ ] History page uses CSS variables
- [ ] CommandPalette uses CSS variables
- [ ] Settings uses CSS variables
- [ ] All pages look correct in dark mode

**Step 4: Test copy**

- [ ] Home page has refined copy
- [ ] Settings page has refined copy
- [ ] Recording settings has refined copy

**Step 5: Test tooltips**

- [ ] API key tooltips work
- [ ] Recording settings tooltips work

**Step 6: Test animations**

- [ ] API key success shimmer works
- [ ] Audio-reactive pulse works (if recording available)
- [ ] Session saved indicator shows
- [ ] Chat typing indicator shows
- [ ] Hover states are consistent

**Step 7: Commit final verification**

```bash
git add -A
git commit -m "chore: complete marketing polish implementation"
```

---

## Success Criteria

- [ ] All screens use CSS variables exclusively (no Tailwind grays)
- [ ] Settings page feels cohesive with rest of app
- [ ] New users understand value prop within 10 seconds
- [ ] Smart Capture and Analysis Modes are explained via tooltips
- [ ] First session completion feels rewarding
- [ ] API key configuration has clear success feedback
- [ ] All clickable elements have consistent hover/press states
