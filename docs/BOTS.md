# Baleybots Reference

All AI processing runs off-main-thread in a Web Worker (`ai-worker.ts`). Each bot is a BAL pipeline compiled at first use and cached for the session. All bots use **Claude Sonnet 4** (`claude-sonnet-4-20250514`).

> **To tune prompts:** edit `src/services/bots/pipelines/definitions.ts`
> **To change output schemas:** edit `src/services/bots/types.ts`
> **To change input formatting:** edit `src/services/bots/input-builders.ts`
> **To change models:** edit `src/services/bots/pipelines/factory.ts`

---

## 1. Activity Detector

**Purpose:** Analyzes each screenshot to understand what the user is doing. This is the workhorse — called on every screenshot capture (every 10-60s depending on activity level).

**Trigger:** Every screenshot capture (smart-capture or interval-based)

**Input:** Multimodal — screenshot image (JPEG base64) + text context about previous analysis

**Output schema:**
```typescript
{
  hasSignificantChange: boolean      // Did something meaningful change since last screenshot?
  currentApp: string | null          // App/website visible (e.g., "VS Code", "Chrome - GitHub")
  currentContext: string             // What user is doing (e.g., "editing React component")
  activityType: 'coding' | 'writing' | 'browsing' | 'designing' | 'meeting' | 'reading' | 'unknown'
  suggestedInsight: string | null    // Notable observation to show user (null = nothing notable)
}
```

**Side effects:**
- If `suggestedInsight` is non-null → creates an insight card in the UI
- If `hasSignificantChange` is true → triggers a summary update

**Prompt:**
```
You are an activity detector analyzing screenshots from a work session.

For each screenshot, determine:
1. Has there been a significant change from the previous context? (hasSignificantChange: true/false)
2. What application/website is being used? (currentApp: app name or null if unknown)
3. What is the user's current context, e.g., 'editing React component', 'reading documentation' (currentContext)
4. What type of activity is this? (activityType: one of 'coding', 'writing', 'browsing', 'designing', 'meeting', 'reading', or 'unknown')
5. Should we generate an insight card? Only if something notable happened. (suggestedInsight: insight text or null)

Be concise but specific. Focus on what's useful for understanding the work session.
```

**Input builder:** `buildActivityDetectorInput(screenshotBase64, previousContext?)`
- Prepends either "Analyze this screenshot from the start of a work session:" or "Previous context: {prev}\n\nAnalyze this new screenshot:"
- Uses `combine(text(...), image(...))` for multimodal Baleybots input

**Files:** `definitions.ts:17-29` → `factory.ts:43-52` → `ai-worker.ts:272-369`

---

## 2. Summarizer

**Purpose:** Maintains a rolling narrative summary of the work session. Called after significant changes or transcription completions.

**Trigger:** Requested by activity detector (on significant change) or after audio transcription

**Input:** Text — formatted session context including current summary, recent screenshot analyses, audio transcripts, and insights

**Output schema:**
```typescript
{
  summary: string        // 2-4 sentence evolving summary of the session
  keyMoments: string[]   // 3-5 bullet points of highlights
  currentFocus: string   // One phrase describing current focus
}
```

**Prompt:**
```
You are a session summarizer. Your job is to maintain a concise, evolving summary of a work session.

You receive:
- The current rolling summary (may be empty at start)
- Recent screenshot analyses describing what the user is doing
- Recent audio transcripts (if available)
- Recent insights already generated

Your output must include:
- summary: An updated 2-4 sentence summary capturing the essence of the session so far
- keyMoments: Array of key moments worth highlighting (max 3-5 bullet points as strings)
- currentFocus: The user's current focus in one phrase

Guidelines:
- Write in present tense for current activity, past tense for completed items
- Be specific about applications, documents, and activities when known
- Keep the summary coherent - it should read as a flowing narrative
- Don't just list activities; synthesize them into meaningful work description
- Each update should refine and extend, not replace entirely
```

**Input builder:** `buildSummarizerInput(context: SessionContext)`
- Formats duration, current summary, recent screenshots with timestamps/apps/analyses, transcripts, and insights

**Files:** `definitions.ts:31-41` → `factory.ts:57-66` → `ai-worker.ts:567-626`

---

## 3. Analysis Controller

**Purpose:** Decides whether to use ambient (light) or deep (intensive) analysis based on activity patterns. Adjusts how aggressively the other bots are invoked.

**Trigger:** Periodically checked during recording sessions

**Input:** Text — session context + activity metrics (app switch count, unique apps, word count, idle time, etc.)

**Output schema:**
```typescript
{
  recommendedMode: 'ambient' | 'deep'
  reason: string              // Why this mode is recommended
  confidence: number          // 0-1, only acts if > 0.7
}
```

**Decision logic:** Only emits a mode change if `confidence > 0.7` AND the recommended mode differs from the current mode.

**Prompt:**
```
You are an analysis controller that decides the appropriate analysis intensity for a work session.

Modes:
- ambient: Light analysis. Good for focused single-app work, quiet periods, or when the user is in flow.
- deep: Intensive real-time analysis. Good for complex multi-app workflows, meetings, rapid context switching.

Consider:
- How frequently is the user switching apps/contexts?
- Is there significant audio activity (meetings, calls)?
- How complex is the current workflow?
- Would more analysis help or just add noise?

Err toward ambient unless there's clear benefit from deep analysis.

Your output must include:
- recommendedMode: Either 'ambient' or 'deep'
- reason: Why you recommend this mode
- confidence: A number between 0 and 1 indicating your confidence
```

**Input builder:** `buildAnalysisControllerInput(context, metrics?)`
- Includes current mode, duration, activity metrics (app switches, unique apps, screenshots, audio words, idle time, focus duration), or falls back to deriving from context

**Files:** `definitions.ts:43-53` → `factory.ts:71-80` → `ai-worker.ts:632-689`

---

## 4. Q&A Bot

**Purpose:** Answers user questions about the current or completed session. Powers the chat interface in the summary view.

**Trigger:** User asks a question in the chat panel

**Input:** Text — session context (summary, recent screenshots, transcripts, insights) + the user's question

**Output schema:**
```typescript
{
  answer: string                     // Response to the user's question
  relevantMoments: string[]          // "HH:MM: description" format (optional)
  suggestedFollowUp: string | null   // Suggested next question
}
```

**Prompt:**
```
You are a helpful assistant that answers questions about a work session.

You have access to:
- A rolling summary of the session
- Recent screenshots with analysis
- Audio transcripts (if available)
- Generated insights

Answer questions naturally and helpfully. If you can reference specific moments or screenshots, do so. If you don't have enough information to answer, say so honestly.

Keep responses concise but informative.

Your output must include:
- answer: Your response to the user's question
- relevantMoments: Array of relevant moments from the session, formatted as 'HH:MM: description' (can be empty)
- suggestedFollowUp: A suggested follow-up question, or null if none
```

**Input builder:** `buildQAInput(question, context)`
- Formats summary, duration, up to 10 recent screenshots with analyses, up to 5 recent transcripts, insights, then the user's question

**Files:** `definitions.ts:55-65` → `factory.ts:85-94` → `ai-worker.ts:695-755`

---

## 5. Final Summary

**Purpose:** Generates a comprehensive wrap-up when a recording session ends. This is the main deliverable — what the user sees in the summary view.

**Trigger:** Session recording is stopped

**Input:** Text — session title, duration, rolling summary, all insights, all audio transcripts, sampled screenshot analyses (up to 20 evenly distributed)

**Output schema:**
```typescript
{
  text: string       // Comprehensive 2-4 paragraph summary of the entire session
  tasks: string[]    // Extracted action items (start with verbs)
  notes: string[]    // Important observations and insights
}
```

**Prompt:**
```
You are a session summarizer creating a comprehensive final summary of a completed work session.

You receive:
- The rolling summary that was maintained during the session
- Insights generated during the session
- Audio transcripts (if available)
- Screenshot analyses describing user activities

Your job is to:
1. Write a comprehensive 2-4 paragraph summary capturing the entire session (text field)
2. Extract ALL actionable tasks and follow-ups as an array of strings (tasks field)
3. Extract key notes and insights worth remembering as an array of strings (notes field)

Guidelines:
- Be specific about applications, documents, and activities
- Tasks should be clear and actionable (start with verbs)
- Notes should capture important decisions, insights, or information
- The summary should tell the complete story of what was accomplished
- Don't miss any tasks mentioned in transcripts or visible in screenshots
- Look for implicit tasks (TODOs, FIXMEs, need to, should, must, etc.)
```

**Input builder:** `buildFinalSummaryInput({ rollingSummary, insights, audioChunks, screenshots, durationSeconds, title })`
- Smart sampling: takes up to 20 screenshots evenly distributed across the session timeline
- Includes all transcripts and insights

**Files:** `definitions.ts:67-77` → `factory.ts:99-108` → `ai-worker.ts:856-919`

---

## 6. Capture

**Purpose:** Analyzes text/content pasted into Quick Capture and extracts structured information. The entry point for non-recording usage.

**Trigger:** User submits text in Quick Capture

**Input:** Text — the captured content + optional attachment descriptions

**Output schema:**
```typescript
{
  title: string      // Concise 2-6 word title
  summary: string    // Brief paragraph summarizing the content
  tasks: string[]    // Action items (start with verbs)
  notes: string[]    // Key insights or notes
}
```

**Prompt:**
```
You are an AI assistant that analyzes captured text and extracts structured information.

Your job is to:
1. Create a concise, descriptive title (2-6 words) in the 'title' field
2. Write a brief summary paragraph in the 'summary' field
3. Extract actionable tasks as an array of strings in the 'tasks' field (start each with a verb)
4. Extract key notes or insights as an array of strings in the 'notes' field

Guidelines:
- Be concise but insightful
- Tasks should be clear and actionable (start with verbs)
- Notes should capture important information or insights
- If there are no clear tasks, return an empty array
- Same for notes - only include if there's something worth noting
- Look for implicit tasks: TODOs, FIXMEs, need to, should, must, etc.
```

**Input builder:** `buildCaptureInput(text, attachmentDescriptions?)`
- Simple: "Please analyze this captured content:" + the text + optional attachments list

**Files:** `definitions.ts:79-90` → `factory.ts:113-122` → `ai-worker.ts:797-850`

---

## 7. Audio Transcription (NOT using Baleybots — should be migrated)

**Purpose:** Transcribes audio chunks using OpenAI Whisper.

**Status: TECH DEBT** — This is a direct API call that bypasses Baleybots entirely. The SDK already has full audio support (see [SDK Audio Capability](#sdk-audio-capability) below). This should be migrated.

**Trigger:** Rust emits `audio-chunk` event every ~10 seconds during recording

**Current implementation:** Manual `fetch()` to `POST https://api.openai.com/v1/audio/transcriptions` with `model: whisper-1`, constructing `FormData` by hand.

**Input:** WAV audio binary (transferred as ArrayBuffer, zero-copy to worker)

**Output:** Plain text transcript

**Side effects:** After transcription, requests a summary update

**Files:** `ai-worker.ts:375-455` (base64 path), `ai-worker.ts:488-561` (binary path)

**What migration would look like:**
```typescript
// Current (manual API call in ai-worker.ts)
const blob = new Blob([audioData], { type: 'audio/wav' });
const formData = new FormData();
formData.append('file', blob, 'audio.wav');
formData.append('model', 'whisper-1');
const response = await fetch('https://api.openai.com/v1/audio/transcriptions', { ... });

// Migrated (using Baleybots audio primitive)
import { audio } from '@baleybots/core';
const blob = new Blob([audioData], { type: 'audio/wav' });
const transcript = await transcriptionBot.process(audio(blob, 'transcribe'));
```

---

## Architecture Summary

```
User Action
  │
  ├─ Quick Capture ──────────────► [6. Capture Bot] ──► title + summary + tasks + notes
  │
  └─ Session Recording
       │
       ├─ Screenshot (10-60s) ──► [1. Activity Detector] ──► context + insight
       │                              │
       │                              ├─ significant change? ──► [2. Summarizer] ──► rolling summary
       │                              └─ notable? ──► insight card
       │
       ├─ Audio chunk (10s) ────► [Whisper Transcription] ──► transcript
       │                              └─ has text? ──► [2. Summarizer]
       │
       ├─ Periodic ─────────────► [3. Analysis Controller] ──► ambient/deep mode switch
       │
       ├─ User asks question ───► [4. Q&A Bot] ──► answer + moments + follow-up
       │
       └─ Session ends ─────────► [5. Final Summary] ──► comprehensive summary + tasks + notes
```

## Model Configuration

All bots use the same model, configured in `factory.ts`:

```typescript
const MODELS = {
  default: 'claude-sonnet-4-20250514',
  capture: 'claude-sonnet-4-20250514',
}
```

To use different models per bot (e.g., Haiku for activity detection, Opus for final summary), modify the `MODELS` object and assign in each `createXxxPipeline()` call.

## Retry & Error Handling

- All pipeline calls wrapped in `withRetry()` (3 attempts, exponential backoff starting at 1s)
- Retries only on rate limits (429), overloaded, or timeout errors
- Non-retryable errors fail immediately
- Worker uses `MessageQueue` for sequential processing (prevents race conditions)
- Worker state machine tracks lifecycle: `IDLE → BOOTSTRAPPING → READY → INITIALIZING → INITIALIZED ⇄ PROCESSING`

---

# Baleybots SDK Reference

The SDK is vendored at `vendor/baleybots/typescript/`. This section documents how it works internally for anyone tuning the AI experience.

## SDK Packages

| Package | Purpose | Used by Sessions? |
|---------|---------|-------------------|
| `@baleybots/core` | Bot creation, pipeline execution, multimodal input, provider adapters | Yes — input builders, config |
| `@baleybots/tools` | BAL DSL parser/interpreter, `Pipeline.from()` | Yes — pipeline compilation |
| `@baleybots/react` | React hooks (`useChat`, `useStream`) | No |
| `@baleybots/chat` | Chat-specific functionality | No |
| `@baleybots/mcp` | Model Context Protocol integration | No |
| `@baleybots/cli` | CLI tools | No |
| `@baleybots/proxy-server` | CORS proxy for browser usage | No |

## Pipeline Execution Flow

```
BAL String (definitions.ts)
  │
  ▼ Pipeline.from(code, { model })
  │
  ├─ Tokenize (lexer.ts) ──► Token stream
  ├─ Parse (parser.ts) ────► AST (EntityDefNode + ChainExprNode)
  └─ Interpret (interpreter.ts) ──► Processable (wraps Baleybot instance)
      │
      ▼ pipeline.process(input)
      │
      ├─ isMultimodal(input)?
      │   ├─ YES → MultimodalRouter
      │   │   ├─ requiresVision? → provider.sendVision()
      │   │   ├─ requiresAudioTranscription? → provider.transcribe()
      │   │   └─ requiresAudioAnalysis? → provider.analyzeAudio()
      │   │
      │   └─ NO → standard text path
      │       ├─ Build messages (system goal + user input)
      │       ├─ Add output schema as tool (Anthropic) or response_schema (OpenAI)
      │       ├─ HTTP request via provider.buildRequest()
      │       ├─ Stream SSE → provider.transformEvent()
      │       ├─ Accumulate content + tool calls
      │       ├─ Execute tools if needed (parallel)
      │       └─ Parse JSON → validate against Zod schema → return typed output
      │
      ▼ Result (typed by output schema)
```

## Input Primitives

All exported from `@baleybots/core`. Defined in `core/src/multimodal.ts`.

| Primitive | Produces | Used in Sessions? |
|-----------|----------|-------------------|
| `text(content)` | `{ text: string }` | Yes — activity detector |
| `image({ data, mediaType })` | `{ images: [MediaImage] }` | Yes — activity detector |
| `audio(blob, mode)` | `{ audio: MediaAudio, mode }` | **No — should be** |
| `frames(...)` | `{ frames: MediaFrame[] }` | No |
| `video(...)` | `{ frames: ... }` | No |
| `combine(...inputs)` | Merged `UnifiedMessageInput` | Yes — activity detector |

All produce a `UnifiedMessageInput` object:
```typescript
interface UnifiedMessageInput {
  text?: string;
  images?: MediaImage[];
  frames?: MediaFrame[] | Iterable<MediaFrame> | AsyncIterable<MediaFrame>;
  audio?: MediaAudio;
  mode?: 'transcribe' | 'analyze';
  responseSchema?: unknown;
}
```

## Provider Layer

Providers implement the `ModelProvider` interface. Key methods:

| Method | Purpose | Providers |
|--------|---------|-----------|
| `buildRequest()` | Convert params → HTTP request | All |
| `transformEvent()` | SSE chunk → stream event | All |
| `sendVision()` | Image analysis | Anthropic, OpenAI |
| `transcribe()` | Audio → text (Whisper) | OpenAI only |
| `analyzeAudio()` | Audio → structured output (GPT-4o-audio) | OpenAI only |

**Provider selection** is automatic from the model string:
- `claude-*` → Anthropic provider
- `gpt-*`, `whisper-*` → OpenAI provider
- `openai:whisper-1` → explicit OpenAI provider with model `whisper-1`

**Fetch configuration:**
- Main thread (`config.ts`): Uses Tauri fetch proxy for CORS bypass
- Worker (`ai-worker.ts`): Uses native `fetch` with `anthropic-dangerous-direct-browser-access` header
- Provider respects `config.fetch` override per-provider

## BAL DSL Grammar

```
// Entity definition
entity_name {
  "goal": "system prompt...",
  "model": "claude-sonnet-4-20250514",    // optional, uses pipeline default
  "output": { "field": "type", ... },      // optional structured output
  "tools": ["tool1", "tool2"],             // optional
  "maxTokens": 4096                        // optional
}

// Compositions
chain { step1 step2 step3 }               // Sequential
parallel { branch1 branch2 }              // Concurrent
if ("condition") { onTrue } else { onFalse }
loop ("until": "condition", "max": 5) { body }

// Variable capture
chain {
  analyzer => result
  writer with { data: $result }
}
```

**Output types** in BAL are simple strings: `"string"`, `"number"`, `"boolean"`, `"array"`, `"object"`. No descriptions or enums in the schema block — describe semantics in the goal text instead.

## SDK Audio Capability

**The SDK already has full audio transcription support.** Verified in the vendored source:

| Component | Location | Status |
|-----------|----------|--------|
| `audio()` input primitive | `core/src/multimodal.ts:292` | Exported, accepts `Blob \| File \| MediaStream` |
| `MediaAudio` type | `core/src/types/media.ts:30` | Defines `{ data, format }` |
| `isMultimodal()` detection | `core/src/multimodal.ts:452` | Checks for `audio` field |
| `requiresAudioTranscription()` | `core/src/multimodal.ts:479` | Routes `mode='transcribe'` |
| `MultimodalRouter` | `core/src/core/multimodal-router.ts:219` | Routes to `provider.transcribe()` |
| `OpenAIProvider.transcribe()` | `core/src/providers/openai/index.ts:475` | Calls Whisper API with FormData |

**What's NOT in the SDK:**
- BAL DSL has no audio-specific entity type — you can't write `transcriber { "model": "whisper-1" }` in BAL and have it automatically route audio. The BAL interpreter creates standard `Baleybot` instances; audio routing happens at the `process()` level based on input type.
- This means transcription must use the **programmatic API** (not BAL):

```typescript
import { Baleybot, audio } from '@baleybots/core';

const transcriber = Baleybot.create({
  name: 'transcriber',
  goal: 'Transcribe audio accurately',
  model: 'openai:whisper-1',  // explicit provider:model format
});

const blob = new Blob([audioData], { type: 'audio/wav' });
const transcript = await transcriber.process(audio(blob, 'transcribe'));
```

**Open question:** Does `Baleybot.process()` with `model: 'openai:whisper-1'` correctly resolve the OpenAI provider and route through `MultimodalRouter` → `provider.transcribe()`? The interpreter uses `provider:model` format (line 576 of `interpreter.ts`), but programmatic `Baleybot.create()` may need explicit `ModelConfig`:

```typescript
const transcriber = Baleybot.create({
  name: 'transcriber',
  goal: 'Transcribe audio accurately',
  model: { id: 'whisper-1', provider: 'openai' },
});
```

This needs testing before migration.

## Key Files Quick Reference

### Sessions app integration
| File | Purpose |
|------|---------|
| `src/services/bots/pipelines/definitions.ts` | All BAL prompt definitions |
| `src/services/bots/pipelines/factory.ts` | Pipeline compilation + model config |
| `src/services/bots/types.ts` | Zod output schemas |
| `src/services/bots/input-builders.ts` | Input formatting for each bot |
| `src/services/bots/config.ts` | API key management, Baleybots global config |
| `src/services/worker/ai-worker.ts` | Worker — all pipeline execution happens here |
| `src/services/worker/ai-worker-client.ts` | Main thread client for the worker |

### SDK internals
| File | Purpose |
|------|---------|
| `vendor/.../core/src/baleybot.ts` | Core bot class, `process()`, multimodal routing |
| `vendor/.../core/src/multimodal.ts` | `text()`, `image()`, `audio()`, `combine()` |
| `vendor/.../core/src/core/multimodal-router.ts` | Routes input to correct provider method |
| `vendor/.../core/src/providers/openai/index.ts` | OpenAI adapter incl. `transcribe()` |
| `vendor/.../core/src/providers/anthropic/messages.ts` | Anthropic adapter |
| `vendor/.../tools/src/baleybots-dsl-v2/pipeline.ts` | `Pipeline.from()` entry point |
| `vendor/.../tools/src/baleybots-dsl-v2/interpreter.ts` | AST → executable Processable |
