# Fix AI Integration - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the critical data flow so that all Baleybots intelligence accumulated during a session is used in the final summary, and consolidate all AI systems to use Baleybots consistently.

**Architecture:** Create a Final Summary Bot that consumes all session data (rolling summary, insights, transcripts, screenshots) and produces the `Summary` type with tasks and notes. Replace direct `ai.ts` calls with Baleybots-based equivalents. Bridge database types to app types.

**Tech Stack:** React 19, TypeScript, Baleybots SDK, Tauri v2, SQLite

---

## Phase 1: Critical Data Flow Fixes (P0)

### Task 1: Create Final Summary Bot

**Files:**
- Create: `src/services/bots/final-summary.ts`
- Modify: `src/services/bots/index.ts:7-19`
- Modify: `src/services/bots/types.ts:46-63`

**Step 1: Add FinalSummary schema to types.ts**

Add after line 46 in `src/services/bots/types.ts`:

```typescript
// Final summary output (matches app's Summary type)
export const FinalSummarySchema = z.object({
  text: z.string().describe('A comprehensive 2-4 paragraph summary of the entire session'),
  tasks: z.array(z.object({
    title: z.string().describe('A clear, actionable task'),
  })).describe('Action items extracted from the session'),
  notes: z.array(z.object({
    content: z.string().describe('A key insight or note worth remembering'),
  })).describe('Important observations and insights'),
});

export type FinalSummary = z.infer<typeof FinalSummarySchema>;
```

**Step 2: Verify types compile**

Run: `cd /Users/jamesmcarthur/sessions && npx tsc --noEmit`
Expected: No errors related to types.ts

**Step 3: Create final-summary.ts**

Create file `src/services/bots/final-summary.ts`:

```typescript
/**
 * Final Summary Bot
 *
 * Generates a comprehensive final summary when a session ends.
 * Consumes all accumulated intelligence: rolling summary, insights,
 * transcripts, and screenshot analyses.
 */

import { Baleybot } from '@baleybots/core';
import { FinalSummarySchema, type FinalSummary } from './types';
import type { DbScreenshot, DbAudioChunk, DbInsight, DbRollingSummary } from '../../types/database';

const SYSTEM_PROMPT = `You are a session summarizer creating a comprehensive final summary of a completed work session.

You receive:
- The rolling summary that was maintained during the session
- Insights generated during the session
- Audio transcripts (if available)
- Screenshot analyses describing user activities

Your job is to:
1. Write a comprehensive 2-4 paragraph summary capturing the entire session
2. Extract ALL actionable tasks and follow-ups (things the user needs to do)
3. Extract key notes and insights worth remembering

Guidelines:
- Be specific about applications, documents, and activities
- Tasks should be clear and actionable (start with verbs)
- Notes should capture important decisions, insights, or information
- The summary should tell the complete story of what was accomplished
- Don't miss any tasks mentioned in transcripts or visible in screenshots
- Look for implicit tasks (TODOs, FIXMEs, "need to", "should", "must", etc.)`;

export function createFinalSummaryBot() {
  return Baleybot.create({
    name: 'final-summary',
    goal: SYSTEM_PROMPT,
    model: 'claude-sonnet-4-20250514',
    outputSchema: FinalSummarySchema,
  });
}

export interface FinalSummaryInput {
  rollingSummary: DbRollingSummary | null;
  insights: DbInsight[];
  audioChunks: DbAudioChunk[];
  screenshots: DbScreenshot[];
  durationSeconds: number;
  title: string;
}

export function buildFinalSummaryInput(input: FinalSummaryInput): string {
  const parts: string[] = [];

  parts.push(`# Session: ${input.title}`);
  parts.push(`Duration: ${Math.floor(input.durationSeconds / 60)} minutes`);

  // Rolling summary from live analysis
  if (input.rollingSummary?.content) {
    parts.push('\n## Live Summary (from during the session):');
    parts.push(input.rollingSummary.content);
  }

  // Insights collected during session
  if (input.insights.length > 0) {
    parts.push('\n## Insights Collected:');
    for (const insight of input.insights) {
      const time = new Date(insight.created_at).toLocaleTimeString();
      parts.push(`- [${time}] (${insight.type}) ${insight.content}`);
    }
  }

  // Audio transcripts
  const transcripts = input.audioChunks
    .filter(c => c.transcript)
    .map(c => c.transcript!);

  if (transcripts.length > 0) {
    parts.push('\n## Audio Transcripts:');
    parts.push(transcripts.join('\n\n'));
  }

  // Screenshot analyses
  const analyzedScreenshots = input.screenshots.filter(s => s.analysis);
  if (analyzedScreenshots.length > 0) {
    parts.push('\n## Activity Log (from screenshots):');
    for (const ss of analyzedScreenshots.slice(0, 20)) { // Limit to avoid token overflow
      const time = new Date(ss.captured_at).toLocaleTimeString();
      const app = ss.app_name || 'Unknown app';
      parts.push(`- [${time}] ${app}: ${ss.analysis}`);
    }
  }

  parts.push('\n---');
  parts.push('Please generate a comprehensive final summary with tasks and notes.');

  return parts.join('\n');
}

export type { FinalSummary };
```

**Step 4: Export from index.ts**

Modify `src/services/bots/index.ts` to add the export. Replace entire file:

```typescript
/**
 * Session Intelligence Bots
 *
 * Export all bots and their utilities.
 */

export * from './types';
export { createSummarizerBot, buildSummarizerInput } from './summarizer';
export { createActivityDetectorBot, buildActivityDetectorInput } from './activity-detector';
export { createAnalysisControllerBot, buildAnalysisControllerInput, type ActivityMetrics } from './analysis-controller';
export { createQABot, buildQAInput } from './qa-bot';
export { createFinalSummaryBot, buildFinalSummaryInput, type FinalSummaryInput } from './final-summary';
export {
  initializeBots,
  updateApiKeys,
  isBotsReady,
  hasApiKey,
  resetBots,
  type BotConfig,
} from './config';
```

**Step 5: Verify compilation**

Run: `cd /Users/jamesmcarthur/sessions && npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
cd /Users/jamesmcarthur/sessions && git add src/services/bots/final-summary.ts src/services/bots/types.ts src/services/bots/index.ts && git commit -m "feat(bots): add Final Summary Bot for session completion

Creates a new Baleybot that generates comprehensive final summaries
with tasks and notes from all accumulated session intelligence.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 2: Update SessionRecording to Use Final Summary Bot

**Files:**
- Modify: `src/components/SessionRecording.tsx:1-10, 179-221`

**Step 1: Add imports for Final Summary Bot and database functions**

Replace lines 1-12 of `src/components/SessionRecording.tsx`:

```typescript
import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Square, Pause, Play, Camera, Mic, AlertCircle, Video, Monitor, Sparkles } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { sessionRecorder, isTauri, checkScreenRecordingPermission, requestScreenRecordingPermission, type RecordingOptions } from '../services/recording'
import { createSession, updateSessionStatus, getRollingSummary, getInsights, getAudioChunks, getScreenshots } from '../services/database'
import { sessionCoordinator } from '../services/session-coordinator'
import { createFinalSummaryBot, buildFinalSummaryInput, initializeBots, isBotsReady } from '../services/bots'
import { generateId } from '../utils/id'
import { useSessionIntelligence } from '../hooks/useSessionIntelligence'
import { LiveSessionPanel } from './LiveSessionPanel'
import { PeripheralGlow } from './PeripheralGlow'
import type { Session, Summary } from '../types'
import type { RecordingConfig } from './RecordingSettings'
```

**Step 2: Replace handleEndSession function**

Replace the `handleEndSession` function (approximately lines 179-221) with:

```typescript
  const handleEndSession = async () => {
    setIsEnding(true)

    try {
      // Stop session coordinator
      await sessionCoordinator.stopSession(sessionIdRef.current)

      // Stop recording and get captured data
      let screenshots: string[] = []
      if (sessionRecorder.isRecording()) {
        const recordingState = await sessionRecorder.stopRecording()
        screenshots = recordingState.screenshots
        console.log('Captured ' + screenshots.length + ' screenshots')
      }

      // Update database session status
      await updateSessionStatus(sessionIdRef.current, 'processing', duration)

      // Gather all Baleybots intelligence from the database
      const [rollingSummary, insights, audioChunks, dbScreenshots] = await Promise.all([
        getRollingSummary(sessionIdRef.current),
        getInsights(sessionIdRef.current),
        getAudioChunks(sessionIdRef.current),
        getScreenshots(sessionIdRef.current),
      ])

      // Generate final summary using Baleybots
      let summary: Summary

      // Ensure bots are initialized
      await initializeBots()

      if (isBotsReady()) {
        // Use Final Summary Bot with all accumulated intelligence
        const finalBot = createFinalSummaryBot()
        const input = buildFinalSummaryInput({
          rollingSummary,
          insights,
          audioChunks,
          screenshots: dbScreenshots,
          durationSeconds: duration,
          title: sessionTitle || 'Untitled Session',
        })

        const result = await finalBot.process(input)

        summary = {
          text: result.text,
          tasks: result.tasks.map((t, i) => ({
            id: generateId(),
            title: t.title,
            completed: false,
          })),
          notes: result.notes.map((n, i) => ({
            id: generateId(),
            content: n.content,
          })),
          generatedAt: new Date().toISOString(),
        }
      } else {
        // Fallback when no API key - create summary from available data
        summary = {
          text: rollingSummary?.content || `Session recorded for ${Math.floor(duration / 60)} minutes. Configure your Claude API key in Settings to enable AI-powered summaries.`,
          tasks: [],
          notes: insights.slice(0, 5).map(i => ({
            id: generateId(),
            content: i.content,
          })),
          generatedAt: new Date().toISOString(),
        }
      }

      // Update database session status to complete
      await updateSessionStatus(sessionIdRef.current, 'complete', duration)

      // Create session
      const session: Session = {
        id: sessionIdRef.current,
        type: 'session',
        title: sessionTitle || 'Untitled Session',
        createdAt: new Date().toISOString(),
        duration,
        summary,
      }

      // Save and navigate
      await addSession(session)
      dispatch({ type: 'STOP_RECORDING' })
      onComplete(session)
    } catch (error) {
      console.error('Failed to end session:', error)
      setIsEnding(false)
    }
  }
```

**Step 3: Verify compilation**

Run: `cd /Users/jamesmcarthur/sessions && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
cd /Users/jamesmcarthur/sessions && git add src/components/SessionRecording.tsx && git commit -m "feat(recording): use Final Summary Bot with all session intelligence

Replaces ai.processSession() with Baleybots Final Summary Bot that
consumes the rolling summary, insights, transcripts, and screenshots
accumulated during the session instead of discarding them.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 3: Fix Multimodal Input in Activity Detector

**Files:**
- Modify: `src/services/bots/activity-detector.ts:1-52`
- Modify: `src/services/session-coordinator.ts:155-163`

**Step 1: Update activity-detector.ts to use combine() helper**

Replace entire `src/services/bots/activity-detector.ts`:

```typescript
/**
 * Activity Detector Bot
 *
 * Analyzes screenshots to detect what the user is doing,
 * identify context changes, and suggest insights.
 */

import { Baleybot, combine, text, image } from '@baleybots/core';
import { ActivityDetectionSchema, type ActivityDetection } from './types';

const SYSTEM_PROMPT = `You are an activity detector analyzing screenshots from a work session.

For each screenshot, determine:
1. Has there been a significant change from the previous context?
2. What application/website is being used?
3. What is the user's current context (e.g., "editing React component", "reading documentation")
4. What type of activity is this?
5. Should we generate an insight card? Only if something notable happened.

Be concise but specific. Focus on what's useful for understanding the work session.`;

export function createActivityDetectorBot() {
  return Baleybot.create({
    name: 'activity-detector',
    goal: SYSTEM_PROMPT,
    model: 'claude-sonnet-4-20250514',
    outputSchema: ActivityDetectionSchema,
  });
}

export function buildActivityDetectorInput(
  screenshotBase64: string,
  previousContext?: string
) {
  // Strip data URL prefix if present
  const imageData = screenshotBase64.replace(/^data:image\/\w+;base64,/, '');

  const textPrompt = previousContext
    ? `Previous context: ${previousContext}\n\nAnalyze this new screenshot:`
    : 'Analyze this screenshot from the start of a work session:';

  // Use the multimodal combine helper for proper Baleybots format
  return combine(
    text(textPrompt),
    image({
      data: imageData,
      mediaType: 'image/png',
    })
  );
}

export type { ActivityDetection };
```

**Step 2: Update session-coordinator.ts to remove type coercion**

In `src/services/session-coordinator.ts`, find lines 155-163 and replace:

```typescript
      // Run activity detection with multimodal input
      // Compare with the most recent previous screenshot (index 0 is the newest in our list)
      const input = bots.buildActivityDetectorInput(
        screenshot.data_base64,
        context.recentScreenshots[0]?.analysis || undefined
      );

      // Pass multimodal content to the activity bot
      // Baleybot handles the multimodal object format
      const result = await this.activityBot!.process(input as unknown as string);
```

With:

```typescript
      // Run activity detection with multimodal input
      // Compare with the most recent previous screenshot (index 0 is the newest in our list)
      const input = bots.buildActivityDetectorInput(
        screenshot.data_base64,
        context.recentScreenshots[0]?.analysis || undefined
      );

      // Pass multimodal content to the activity bot
      // Baleybots combine() returns the correct format
      const result = await this.activityBot!.process(input);
```

**Step 3: Verify compilation**

Run: `cd /Users/jamesmcarthur/sessions && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
cd /Users/jamesmcarthur/sessions && git add src/services/bots/activity-detector.ts src/services/session-coordinator.ts && git commit -m "fix(bots): use combine() helper for multimodal input

Replaces custom object format with proper Baleybots combine() helper
for multimodal input. Removes unsafe type coercion in coordinator.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 4: Remove ai.ts Import from SessionRecording

**Files:**
- Modify: `src/components/SessionRecording.tsx:5`

**Step 1: Remove the ai import**

The old import `import { ai } from '../services/ai'` should already be gone from Task 2. Verify by checking line 5 - it should NOT have `ai` imported.

**Step 2: Verify the ai import is removed**

Run: `grep -n "from '../services/ai'" /Users/jamesmcarthur/sessions/src/components/SessionRecording.tsx`
Expected: No output (import should not exist)

**Step 3: Verify compilation**

Run: `cd /Users/jamesmcarthur/sessions && npx tsc --noEmit`
Expected: No errors

---

## Phase 2: Consolidate AI Systems (P1)

### Task 5: Create Capture Bot for Quick Capture

**Files:**
- Create: `src/services/bots/capture.ts`
- Modify: `src/services/bots/index.ts`
- Modify: `src/services/bots/types.ts`

**Step 1: Add CaptureResult schema to types.ts**

Add after the FinalSummarySchema in `src/services/bots/types.ts`:

```typescript
// Capture processing output
export const CaptureResultSchema = z.object({
  title: z.string().describe('A concise 2-6 word title for the capture'),
  summary: z.string().describe('A brief paragraph summarizing the captured content'),
  tasks: z.array(z.object({
    title: z.string().describe('A clear, actionable task'),
  })).describe('Action items extracted from the content'),
  notes: z.array(z.object({
    content: z.string().describe('A key insight or note'),
  })).describe('Important observations'),
});

export type CaptureResult = z.infer<typeof CaptureResultSchema>;
```

**Step 2: Create capture.ts**

Create file `src/services/bots/capture.ts`:

```typescript
/**
 * Capture Bot
 *
 * Processes quick captures (text, pasted content) and extracts
 * structured information: title, summary, tasks, and notes.
 */

import { Baleybot } from '@baleybots/core';
import { CaptureResultSchema, type CaptureResult } from './types';

const SYSTEM_PROMPT = `You are an AI assistant that analyzes captured text and extracts structured information.

Your job is to:
1. Create a concise, descriptive title (2-6 words)
2. Write a brief summary paragraph capturing the essence
3. Extract actionable tasks (things to do, follow up on)
4. Extract key notes or insights worth remembering

Guidelines:
- Be concise but insightful
- Tasks should be clear and actionable (start with verbs)
- Notes should capture important information or insights
- If there are no clear tasks, return an empty array
- Same for notes - only include if there's something worth noting
- Look for implicit tasks: TODOs, FIXMEs, "need to", "should", "must", etc.`;

export function createCaptureBot() {
  return Baleybot.create({
    name: 'capture',
    goal: SYSTEM_PROMPT,
    model: 'claude-sonnet-4-20250514',
    outputSchema: CaptureResultSchema,
  });
}

export function buildCaptureInput(text: string, attachmentDescriptions?: string[]): string {
  const parts: string[] = [];

  parts.push('Please analyze this captured content:');
  parts.push('');
  parts.push(text);

  if (attachmentDescriptions && attachmentDescriptions.length > 0) {
    parts.push('');
    parts.push('Attachments:');
    for (const desc of attachmentDescriptions) {
      parts.push(`- ${desc}`);
    }
  }

  return parts.join('\n');
}

export type { CaptureResult };
```

**Step 3: Export from index.ts**

Add to `src/services/bots/index.ts`:

```typescript
export { createCaptureBot, buildCaptureInput } from './capture';
```

**Step 4: Verify compilation**

Run: `cd /Users/jamesmcarthur/sessions && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
cd /Users/jamesmcarthur/sessions && git add src/services/bots/capture.ts src/services/bots/types.ts src/services/bots/index.ts && git commit -m "feat(bots): add Capture Bot for quick capture processing

Creates a new Baleybot that processes quick captures and extracts
title, summary, tasks, and notes consistently with other bots.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 6: Update QuickCapture to Use Capture Bot

**Files:**
- Modify: `src/components/QuickCapture.tsx:1-70`

**Step 1: Update imports**

Replace lines 1-7 of `src/components/QuickCapture.tsx`:

```typescript
import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Sparkles, Paperclip, X, Image as ImageIcon, FileText, Feather } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { createCaptureBot, buildCaptureInput, initializeBots, isBotsReady } from '../services/bots'
import { generateId } from '../utils/id'
import type { Session, Summary } from '../types'
```

**Step 2: Replace handleSubmit function**

Replace the `handleSubmit` function (approximately lines 37-70) with:

```typescript
  const handleSubmit = async () => {
    if (!text.trim() && attachments.length === 0) return

    setIsProcessing(true)
    setProcessingStage('Reading your thoughts...')

    try {
      // Ensure bots are initialized
      await initializeBots()

      await new Promise(r => setTimeout(r, 500))
      setProcessingStage('Extracting insights...')

      let title: string
      let summary: Summary

      if (isBotsReady()) {
        // Use Capture Bot
        const captureBot = createCaptureBot()

        // Build attachment descriptions
        const attachmentDescriptions = attachments.map(f =>
          `${f.type.startsWith('image/') ? 'Image' : 'File'}: ${f.name}`
        )

        const input = buildCaptureInput(text, attachmentDescriptions)
        const result = await captureBot.process(input)

        title = result.title
        summary = {
          text: result.summary,
          tasks: result.tasks.map(t => ({
            id: generateId(),
            title: t.title,
            completed: false,
          })),
          notes: result.notes.map(n => ({
            id: generateId(),
            content: n.content,
          })),
          generatedAt: new Date().toISOString(),
        }
      } else {
        // Fallback when no API key
        const words = text.split(/\s+/).length
        title = words < 10 ? 'Quick Note' : 'Captured Notes'
        summary = {
          text: `Captured ${words} words. Configure your Claude API key in Settings to enable AI-powered analysis.`,
          tasks: [],
          notes: [],
          generatedAt: new Date().toISOString(),
        }
      }

      setProcessingStage('Crafting your summary...')
      await new Promise(r => setTimeout(r, 300))

      // Create session
      const session: Session = {
        id: generateId(),
        type: 'capture',
        title,
        createdAt: new Date().toISOString(),
        captureText: text,
        summary,
      }

      // Save and navigate
      await addSession(session)
      onComplete(session)
    } catch (error) {
      console.error('Failed to process capture:', error)
      setIsProcessing(false)
      setProcessingStage('')
    }
  }
```

**Step 3: Verify compilation**

Run: `cd /Users/jamesmcarthur/sessions && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
cd /Users/jamesmcarthur/sessions && git add src/components/QuickCapture.tsx && git commit -m "feat(capture): use Capture Bot instead of ai.ts

Replaces ai.processCapture() with Baleybots Capture Bot for
consistent AI processing across the app.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 7: Migrate SummaryView Chat to Use QA Bot

**Files:**
- Modify: `src/components/SummaryView.tsx:1-30, 113-154, 170-204`

**Step 1: Update imports**

Replace lines 1-22 of `src/components/SummaryView.tsx`:

```typescript
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Send,
  Video,
  Feather,
  Trash2,
  MoreHorizontal,
  AlertCircle,
  X,
  Sparkles,
  BookOpen,
  ListChecks,
  StickyNote,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { createQABot, buildQAInput, initializeBots, isBotsReady, type SessionContext } from '../services/bots'
import { generateId } from '../utils/id'
import type { Session } from '../types'
```

**Step 2: Replace handleSendMessage function**

Replace the `handleSendMessage` function (approximately lines 113-154) with:

```typescript
  const handleSendMessage = async () => {
    if (!chatInput.trim() || isSending) return

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: chatInput,
    }

    setChatMessages((prev) => [...prev, userMessage])
    setChatInput('')
    setIsSending(true)
    setChatError(null)

    try {
      await initializeBots()

      if (!isBotsReady()) {
        throw new Error('API key not configured. Please add your Claude API key in Settings.')
      }

      // Build session context for QA Bot
      const context: SessionContext = {
        sessionId: session.id,
        rollingSummary: session.summary?.text || '',
        recentScreenshots: [],
        recentTranscripts: [],
        recentInsights: session.summary?.notes.map(n => n.content) || [],
        durationSeconds: session.duration || 0,
        analysisMode: 'ambient',
      }

      const qaBot = createQABot()
      const input = buildQAInput(chatInput, context)
      const result = await qaBot.process(input)

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: result.answer,
      }

      setChatMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      console.error('Chat error:', error)
      setChatError(
        error instanceof Error
          ? error.message
          : 'Failed to get response. Check your API key in Settings.'
      )
    } finally {
      setIsSending(false)
    }
  }
```

**Step 3: Replace handleSuggestionClick function**

Replace the `handleSuggestionClick` function (approximately lines 170-204) with:

```typescript
  const handleSuggestionClick = async (prompt: string) => {
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: prompt,
    }
    setChatMessages((prev) => [...prev, userMessage])
    setIsSending(true)
    setChatError(null)

    try {
      await initializeBots()

      if (!isBotsReady()) {
        throw new Error('API key not configured. Please add your Claude API key in Settings.')
      }

      // Build session context for QA Bot
      const context: SessionContext = {
        sessionId: session.id,
        rollingSummary: session.summary?.text || '',
        recentScreenshots: [],
        recentTranscripts: [],
        recentInsights: session.summary?.notes.map(n => n.content) || [],
        durationSeconds: session.duration || 0,
        analysisMode: 'ambient',
      }

      const qaBot = createQABot()
      const input = buildQAInput(prompt, context)
      const result = await qaBot.process(input)

      setChatMessages((prev) => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: result.answer,
      }])
    } catch (error) {
      console.error('Chat error:', error)
      setChatError(
        error instanceof Error
          ? error.message
          : 'Failed to get response. Check your API key in Settings.'
      )
    } finally {
      setIsSending(false)
    }
  }
```

**Step 4: Verify compilation**

Run: `cd /Users/jamesmcarthur/sessions && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
cd /Users/jamesmcarthur/sessions && git add src/components/SummaryView.tsx && git commit -m "feat(summary): use QA Bot instead of ai.chat()

Replaces ai.chat() with Baleybots QA Bot for consistent AI
processing. All chat now goes through the same bot system.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 8: Deprecate ai.ts (Mark as Legacy)

**Files:**
- Modify: `src/services/ai.ts:1-10`

**Step 1: Add deprecation notice to ai.ts**

Add at the top of `src/services/ai.ts` (after line 1):

```typescript
/**
 * AI Service
 *
 * @deprecated This service is deprecated. Use Baleybots instead:
 * - For captures: use createCaptureBot() from './bots'
 * - For sessions: use createFinalSummaryBot() from './bots'
 * - For chat: use createQABot() from './bots'
 *
 * This file is kept for reference but should not be used for new code.
 */
```

**Step 2: Verify no remaining imports of ai.ts in components**

Run: `grep -r "from '../services/ai'" /Users/jamesmcarthur/sessions/src/components/`
Expected: No output (no components should import ai.ts)

**Step 3: Commit**

```bash
cd /Users/jamesmcarthur/sessions && git add src/services/ai.ts && git commit -m "chore: deprecate ai.ts in favor of Baleybots

All AI functionality has been migrated to Baleybots. This file is
kept for reference but marked as deprecated.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 3: Add Missing UI (P1 continued)

### Task 9: Add Screenshot Gallery Component

**Files:**
- Create: `src/components/ScreenshotGallery.tsx`
- Modify: `src/components/SummaryView.tsx` (add gallery section)

**Step 1: Create ScreenshotGallery component**

Create file `src/components/ScreenshotGallery.tsx`:

```typescript
/**
 * Screenshot Gallery
 *
 * Displays captured screenshots from a session in a grid/carousel.
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronLeft, ChevronRight, Camera } from 'lucide-react'
import type { DbScreenshot } from '../types/database'

interface ScreenshotGalleryProps {
  screenshots: DbScreenshot[]
}

export function ScreenshotGallery({ screenshots }: ScreenshotGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  if (screenshots.length === 0) {
    return null
  }

  const selectedScreenshot = selectedIndex !== null ? screenshots[selectedIndex] : null

  return (
    <>
      {/* Grid View */}
      <div className="grid grid-cols-3 gap-3">
        {screenshots.slice(0, 9).map((ss, index) => (
          <button
            key={ss.id}
            onClick={() => setSelectedIndex(index)}
            className="aspect-video rounded-lg overflow-hidden border border-[var(--border-subtle)] hover:border-[var(--accent)] transition-colors relative group"
          >
            <img
              src={ss.data_base64.startsWith('data:') ? ss.data_base64 : `data:image/png;base64,${ss.data_base64}`}
              alt={`Screenshot ${index + 1}`}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
            <div className="absolute bottom-1 left-1 text-xs text-white bg-black/50 px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity">
              {new Date(ss.captured_at).toLocaleTimeString()}
            </div>
          </button>
        ))}
        {screenshots.length > 9 && (
          <div className="aspect-video rounded-lg bg-[var(--paper-warm)] border border-[var(--border-subtle)] flex items-center justify-center">
            <span className="text-sm text-[var(--ink-muted)]">
              +{screenshots.length - 9} more
            </span>
          </div>
        )}
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {selectedScreenshot && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
            onClick={() => setSelectedIndex(null)}
          >
            <button
              onClick={() => setSelectedIndex(null)}
              className="absolute top-4 right-4 p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
            >
              <X className="w-6 h-6 text-white" />
            </button>

            {selectedIndex !== null && selectedIndex > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setSelectedIndex(selectedIndex - 1)
                }}
                className="absolute left-4 p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              >
                <ChevronLeft className="w-6 h-6 text-white" />
              </button>
            )}

            {selectedIndex !== null && selectedIndex < screenshots.length - 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setSelectedIndex(selectedIndex + 1)
                }}
                className="absolute right-4 p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              >
                <ChevronRight className="w-6 h-6 text-white" />
              </button>
            )}

            <div onClick={(e) => e.stopPropagation()} className="max-w-5xl max-h-[80vh] px-16">
              <img
                src={selectedScreenshot.data_base64.startsWith('data:')
                  ? selectedScreenshot.data_base64
                  : `data:image/png;base64,${selectedScreenshot.data_base64}`}
                alt="Screenshot"
                className="max-w-full max-h-[80vh] object-contain rounded-lg"
              />
              <div className="mt-4 text-center">
                <p className="text-white/80 text-sm">
                  {new Date(selectedScreenshot.captured_at).toLocaleString()}
                  {selectedScreenshot.app_name && ` • ${selectedScreenshot.app_name}`}
                </p>
                {selectedScreenshot.analysis && (
                  <p className="text-white/60 text-sm mt-2 max-w-2xl mx-auto">
                    {selectedScreenshot.analysis}
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
```

**Step 2: Verify compilation**

Run: `cd /Users/jamesmcarthur/sessions && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
cd /Users/jamesmcarthur/sessions && git add src/components/ScreenshotGallery.tsx && git commit -m "feat(ui): add Screenshot Gallery component

Displays session screenshots in a grid with lightbox viewer.
Shows timestamp, app name, and AI analysis for each screenshot.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 10: Add Transcript Viewer Component

**Files:**
- Create: `src/components/TranscriptViewer.tsx`

**Step 1: Create TranscriptViewer component**

Create file `src/components/TranscriptViewer.tsx`:

```typescript
/**
 * Transcript Viewer
 *
 * Displays audio transcripts from a session with timestamps.
 */

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Mic, ChevronDown, ChevronUp } from 'lucide-react'
import type { DbAudioChunk } from '../types/database'

interface TranscriptViewerProps {
  audioChunks: DbAudioChunk[]
}

export function TranscriptViewer({ audioChunks }: TranscriptViewerProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  // Filter to only chunks with transcripts
  const transcribedChunks = audioChunks.filter(c => c.transcript)

  if (transcribedChunks.length === 0) {
    return null
  }

  // Combine all transcripts for preview
  const fullTranscript = transcribedChunks.map(c => c.transcript).join(' ')
  const previewLength = 200

  return (
    <div className="rounded-xl bg-[var(--paper-warm)] border border-[var(--border-subtle)] overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-[var(--paper-dark)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--accent-muted)] flex items-center justify-center">
            <Mic className="w-4 h-4 text-[var(--accent)]" />
          </div>
          <div className="text-left">
            <h3 className="font-medium text-[var(--ink)]">Audio Transcript</h3>
            <p className="text-xs text-[var(--ink-muted)]">
              {transcribedChunks.length} segment{transcribedChunks.length !== 1 ? 's' : ''} •
              {Math.round(fullTranscript.split(/\s+/).length)} words
            </p>
          </div>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-5 h-5 text-[var(--ink-muted)]" />
        ) : (
          <ChevronDown className="w-5 h-5 text-[var(--ink-muted)]" />
        )}
      </button>

      {/* Content */}
      <motion.div
        initial={false}
        animate={{ height: isExpanded ? 'auto' : 0 }}
        className="overflow-hidden"
      >
        <div className="p-4 pt-0 space-y-4">
          {isExpanded ? (
            // Full transcript with timestamps
            transcribedChunks.map((chunk, index) => (
              <div key={chunk.id} className="flex gap-3">
                <div className="flex-shrink-0 text-xs text-[var(--ink-muted)] w-16 pt-0.5">
                  {new Date(chunk.start_time).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </div>
                <p className="text-sm text-[var(--ink)] leading-relaxed">
                  {chunk.transcript}
                </p>
              </div>
            ))
          ) : (
            // Preview
            <p className="text-sm text-[var(--ink-muted)] leading-relaxed">
              {fullTranscript.length > previewLength
                ? fullTranscript.slice(0, previewLength) + '...'
                : fullTranscript}
            </p>
          )}
        </div>
      </motion.div>
    </div>
  )
}
```

**Step 2: Verify compilation**

Run: `cd /Users/jamesmcarthur/sessions && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
cd /Users/jamesmcarthur/sessions && git add src/components/TranscriptViewer.tsx && git commit -m "feat(ui): add Transcript Viewer component

Displays audio transcripts with timestamps in an expandable view.
Shows word count and segment count in collapsed state.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 11: Integrate Gallery and Transcript into SummaryView

**Files:**
- Modify: `src/components/SummaryView.tsx`

**Step 1: Add imports and state for screenshots/transcripts**

At the top of `src/components/SummaryView.tsx`, add to imports:

```typescript
import { ScreenshotGallery } from './ScreenshotGallery'
import { TranscriptViewer } from './TranscriptViewer'
import { getScreenshots, getAudioChunks } from '../services/database'
import type { DbScreenshot, DbAudioChunk } from '../types/database'
```

**Step 2: Add state and useEffect to load session data**

After the existing useState declarations (around line 87-92), add:

```typescript
  const [screenshots, setScreenshots] = useState<DbScreenshot[]>([])
  const [audioChunks, setAudioChunks] = useState<DbAudioChunk[]>([])
  const [loadingMedia, setLoadingMedia] = useState(true)

  // Load screenshots and audio chunks for sessions
  useEffect(() => {
    if (session.type === 'session') {
      Promise.all([
        getScreenshots(session.id),
        getAudioChunks(session.id),
      ]).then(([ss, ac]) => {
        setScreenshots(ss)
        setAudioChunks(ac)
        setLoadingMedia(false)
      }).catch(err => {
        console.error('Failed to load session media:', err)
        setLoadingMedia(false)
      })
    } else {
      setLoadingMedia(false)
    }
  }, [session.id, session.type])
```

**Step 3: Add sections for screenshots and transcripts in the render**

After the Notes Section (around line 450), add:

```typescript
            {/* Screenshots Section (for sessions only) */}
            {session.type === 'session' && screenshots.length > 0 && (
              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="flex items-center gap-3 mb-5">
                  <Camera className="w-5 h-5 text-[var(--ink-muted)]" />
                  <h2 className="label-section">Screenshots</h2>
                </div>
                <ScreenshotGallery screenshots={screenshots} />
              </motion.section>
            )}

            {/* Transcript Section (for sessions only) */}
            {session.type === 'session' && audioChunks.length > 0 && (
              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
              >
                <TranscriptViewer audioChunks={audioChunks} />
              </motion.section>
            )}
```

Also add `Camera` to the lucide-react imports at the top.

**Step 4: Verify compilation**

Run: `cd /Users/jamesmcarthur/sessions && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
cd /Users/jamesmcarthur/sessions && git add src/components/SummaryView.tsx && git commit -m "feat(summary): integrate Screenshot Gallery and Transcript Viewer

Sessions now display captured screenshots and audio transcripts
in the summary view, making all session data accessible.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 12: Final Verification and Cleanup

**Files:**
- None (verification only)

**Step 1: Run full type check**

Run: `cd /Users/jamesmcarthur/sessions && npx tsc --noEmit`
Expected: No errors

**Step 2: Run ESLint**

Run: `cd /Users/jamesmcarthur/sessions && npm run lint`
Expected: No errors (or only pre-existing ones)

**Step 3: Verify the app builds**

Run: `cd /Users/jamesmcarthur/sessions && npm run build`
Expected: Build succeeds

**Step 4: Test the app runs**

Run: `cd /Users/jamesmcarthur/sessions && npm run dev`
Expected: App starts without errors

**Step 5: Create summary commit**

```bash
cd /Users/jamesmcarthur/sessions && git add -A && git status
```

If there are any unstaged changes, review and commit them.

---

## Summary of Changes

### New Files Created:
- `src/services/bots/final-summary.ts` - Final Summary Bot
- `src/services/bots/capture.ts` - Capture Bot
- `src/components/ScreenshotGallery.tsx` - Screenshot viewer
- `src/components/TranscriptViewer.tsx` - Transcript viewer

### Files Modified:
- `src/services/bots/types.ts` - Added FinalSummary and CaptureResult schemas
- `src/services/bots/index.ts` - Added exports for new bots
- `src/services/bots/activity-detector.ts` - Fixed multimodal input format
- `src/services/session-coordinator.ts` - Removed type coercion
- `src/components/SessionRecording.tsx` - Uses Final Summary Bot
- `src/components/QuickCapture.tsx` - Uses Capture Bot
- `src/components/SummaryView.tsx` - Uses QA Bot, added galleries
- `src/services/ai.ts` - Marked as deprecated

### Key Fixes:
1. Session endings now use ALL accumulated Baleybots intelligence
2. All AI processing goes through Baleybots consistently
3. Multimodal input uses proper `combine()` helper
4. Screenshots and transcripts are viewable in SummaryView
