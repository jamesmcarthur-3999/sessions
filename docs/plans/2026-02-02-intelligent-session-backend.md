# Intelligent Session Recording - Backend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the intelligence backend that powers real-time session analysis using Baleybots for AI orchestration and SQLite for data persistence.

**Architecture:** Baleybots SDK handles AI agent coordination in the frontend (React), communicating with Claude API via a proxy pattern. SQLite (via Tauri) stores all session data. Event-driven capture system triggers analysis. Streaming events flow from bots to UI components.

**Tech Stack:**
- Baleybots SDK (`@baleybots/core`, `@baleybots/chat`, `@baleybots/react`)
- SQLite via `tauri-plugin-sql`
- Tauri event system for Rust ↔ React communication
- Zod for schema validation

---

## Phase 1: Foundation Setup

### Task 1: Add Baleybots Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install Baleybots packages**

Run:
```bash
cd /Users/jamesmcarthur/sessions
npm install @baleybots/core@latest @baleybots/chat@latest @baleybots/react@latest zod ai @ai-sdk/anthropic
```

Expected: Packages install successfully

**Step 2: Verify installation**

Run:
```bash
npm ls @baleybots/core @baleybots/chat @baleybots/react
```

Expected: All three packages listed

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add baleybots SDK and dependencies"
```

---

### Task 2: Add SQLite to Tauri

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`

**Step 1: Add tauri-plugin-sql dependency**

In `src-tauri/Cargo.toml`, add to `[dependencies]`:

```toml
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
```

**Step 2: Register the SQL plugin**

In `src-tauri/src/lib.rs`, modify the `run()` function. Add after `tauri::Builder::default()`:

```rust
.plugin(tauri_plugin_sql::Builder::new().build())
```

The builder chain should look like:
```rust
tauri::Builder::default()
    .plugin(tauri_plugin_sql::Builder::new().build())
    .manage(audio_recorder.clone())
    // ... rest of chain
```

**Step 3: Add SQL capability**

In `src-tauri/capabilities/default.json`, add to the `permissions` array:

```json
"sql:default",
"sql:allow-load",
"sql:allow-execute",
"sql:allow-select",
"sql:allow-close"
```

**Step 4: Verify Rust compiles**

Run:
```bash
cd /Users/jamesmcarthur/sessions
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: Compiles with no errors

**Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "deps: add SQLite support via tauri-plugin-sql"
```

---

### Task 3: Create Database Schema and Service

**Files:**
- Create: `src/services/database.ts`
- Create: `src/types/database.ts`

**Step 1: Create database types**

Create `src/types/database.ts`:

```typescript
/**
 * Database Types for Session Intelligence
 */

// Core session record
export interface DbSession {
  id: string;
  type: 'session' | 'capture';
  title: string;
  created_at: string;
  updated_at: string;
  duration_seconds: number | null;
  status: 'recording' | 'processing' | 'complete' | 'error';
  analysis_mode: 'ambient' | 'deep';
}

// Screenshot captures
export interface DbScreenshot {
  id: string;
  session_id: string;
  captured_at: string;
  trigger: 'interval' | 'app_switch' | 'activity' | 'manual';
  app_name: string | null;
  window_title: string | null;
  data_base64: string;
  analysis: string | null; // JSON string of AI analysis
}

// Audio chunks
export interface DbAudioChunk {
  id: string;
  session_id: string;
  start_time: string;
  end_time: string;
  duration_seconds: number;
  data_base64: string;
  transcript: string | null;
}

// AI-generated insights
export interface DbInsight {
  id: string;
  session_id: string;
  created_at: string;
  type: 'activity' | 'summary' | 'moment' | 'suggestion';
  content: string;
  metadata: string | null; // JSON string
  pinned: boolean;
}

// Rolling summary (living document)
export interface DbRollingSummary {
  id: string;
  session_id: string;
  updated_at: string;
  content: string;
  version: number;
}

// Chat messages
export interface DbChatMessage {
  id: string;
  session_id: string;
  created_at: string;
  role: 'user' | 'assistant';
  content: string;
  metadata: string | null; // JSON string
}

// Analysis state
export interface DbAnalysisState {
  session_id: string;
  mode: 'ambient' | 'deep';
  last_screenshot_id: string | null;
  last_audio_chunk_id: string | null;
  updated_at: string;
}
```

**Step 2: Create database service**

Create `src/services/database.ts`:

```typescript
/**
 * Database Service
 *
 * SQLite-based storage for session intelligence data.
 * Uses tauri-plugin-sql for native database access.
 */

import Database from '@tauri-apps/plugin-sql';
import { generateId } from '../utils/id';
import type {
  DbSession,
  DbScreenshot,
  DbAudioChunk,
  DbInsight,
  DbRollingSummary,
  DbChatMessage,
  DbAnalysisState,
} from '../types/database';

let db: Database | null = null;

const SCHEMA = `
-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('session', 'capture')),
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  duration_seconds INTEGER,
  status TEXT NOT NULL DEFAULT 'recording' CHECK (status IN ('recording', 'processing', 'complete', 'error')),
  analysis_mode TEXT NOT NULL DEFAULT 'ambient' CHECK (analysis_mode IN ('ambient', 'deep'))
);

-- Screenshots table
CREATE TABLE IF NOT EXISTS screenshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('interval', 'app_switch', 'activity', 'manual')),
  app_name TEXT,
  window_title TEXT,
  data_base64 TEXT NOT NULL,
  analysis TEXT
);
CREATE INDEX IF NOT EXISTS idx_screenshots_session ON screenshots(session_id);
CREATE INDEX IF NOT EXISTS idx_screenshots_time ON screenshots(captured_at);

-- Audio chunks table
CREATE TABLE IF NOT EXISTS audio_chunks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  duration_seconds REAL NOT NULL,
  data_base64 TEXT NOT NULL,
  transcript TEXT
);
CREATE INDEX IF NOT EXISTS idx_audio_session ON audio_chunks(session_id);

-- Insights table
CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('activity', 'summary', 'moment', 'suggestion')),
  content TEXT NOT NULL,
  metadata TEXT,
  pinned INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_insights_session ON insights(session_id);
CREATE INDEX IF NOT EXISTS idx_insights_type ON insights(type);

-- Rolling summary table (one per session)
CREATE TABLE IF NOT EXISTS rolling_summaries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata TEXT
);
CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id);

-- Analysis state table (one per session)
CREATE TABLE IF NOT EXISTS analysis_state (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'ambient' CHECK (mode IN ('ambient', 'deep')),
  last_screenshot_id TEXT,
  last_audio_chunk_id TEXT,
  updated_at TEXT NOT NULL
);
`;

/**
 * Initialize the database connection and create schema
 */
export async function initDatabase(): Promise<void> {
  if (db) return;

  db = await Database.load('sqlite:sessions.db');

  // Create tables
  const statements = SCHEMA.split(';').filter(s => s.trim());
  for (const statement of statements) {
    await db.execute(statement);
  }

  console.log('Database initialized');
}

/**
 * Get the database instance (must call initDatabase first)
 */
export function getDb(): Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

// ============================================================================
// Sessions
// ============================================================================

export async function createSession(
  type: 'session' | 'capture',
  title: string,
  analysisMode: 'ambient' | 'deep' = 'ambient'
): Promise<DbSession> {
  const now = new Date().toISOString();
  const session: DbSession = {
    id: generateId(),
    type,
    title,
    created_at: now,
    updated_at: now,
    duration_seconds: null,
    status: 'recording',
    analysis_mode: analysisMode,
  };

  await getDb().execute(
    `INSERT INTO sessions (id, type, title, created_at, updated_at, status, analysis_mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [session.id, session.type, session.title, session.created_at, session.updated_at, session.status, session.analysis_mode]
  );

  // Initialize analysis state
  await getDb().execute(
    `INSERT INTO analysis_state (session_id, mode, updated_at)
     VALUES ($1, $2, $3)`,
    [session.id, analysisMode, now]
  );

  // Initialize rolling summary
  await getDb().execute(
    `INSERT INTO rolling_summaries (id, session_id, updated_at, content, version)
     VALUES ($1, $2, $3, $4, $5)`,
    [generateId(), session.id, now, '', 1]
  );

  return session;
}

export async function getSession(id: string): Promise<DbSession | null> {
  const result = await getDb().select<DbSession[]>(
    'SELECT * FROM sessions WHERE id = $1',
    [id]
  );
  return result[0] || null;
}

export async function updateSessionStatus(
  id: string,
  status: DbSession['status'],
  durationSeconds?: number
): Promise<void> {
  const now = new Date().toISOString();
  await getDb().execute(
    `UPDATE sessions SET status = $1, duration_seconds = $2, updated_at = $3 WHERE id = $4`,
    [status, durationSeconds ?? null, now, id]
  );
}

// ============================================================================
// Screenshots
// ============================================================================

export async function saveScreenshot(
  sessionId: string,
  dataBase64: string,
  trigger: DbScreenshot['trigger'],
  appName?: string,
  windowTitle?: string
): Promise<DbScreenshot> {
  const screenshot: DbScreenshot = {
    id: generateId(),
    session_id: sessionId,
    captured_at: new Date().toISOString(),
    trigger,
    app_name: appName ?? null,
    window_title: windowTitle ?? null,
    data_base64: dataBase64,
    analysis: null,
  };

  await getDb().execute(
    `INSERT INTO screenshots (id, session_id, captured_at, trigger, app_name, window_title, data_base64)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [screenshot.id, screenshot.session_id, screenshot.captured_at, screenshot.trigger, screenshot.app_name, screenshot.window_title, screenshot.data_base64]
  );

  return screenshot;
}

export async function getScreenshots(
  sessionId: string,
  limit?: number
): Promise<DbScreenshot[]> {
  const query = limit
    ? 'SELECT * FROM screenshots WHERE session_id = $1 ORDER BY captured_at DESC LIMIT $2'
    : 'SELECT * FROM screenshots WHERE session_id = $1 ORDER BY captured_at DESC';
  const params = limit ? [sessionId, limit] : [sessionId];
  return getDb().select<DbScreenshot[]>(query, params);
}

export async function updateScreenshotAnalysis(
  id: string,
  analysis: string
): Promise<void> {
  await getDb().execute(
    'UPDATE screenshots SET analysis = $1 WHERE id = $2',
    [analysis, id]
  );
}

// ============================================================================
// Audio Chunks
// ============================================================================

export async function saveAudioChunk(
  sessionId: string,
  startTime: string,
  endTime: string,
  durationSeconds: number,
  dataBase64: string
): Promise<DbAudioChunk> {
  const chunk: DbAudioChunk = {
    id: generateId(),
    session_id: sessionId,
    start_time: startTime,
    end_time: endTime,
    duration_seconds: durationSeconds,
    data_base64: dataBase64,
    transcript: null,
  };

  await getDb().execute(
    `INSERT INTO audio_chunks (id, session_id, start_time, end_time, duration_seconds, data_base64)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [chunk.id, chunk.session_id, chunk.start_time, chunk.end_time, chunk.duration_seconds, chunk.data_base64]
  );

  return chunk;
}

export async function updateAudioTranscript(
  id: string,
  transcript: string
): Promise<void> {
  await getDb().execute(
    'UPDATE audio_chunks SET transcript = $1 WHERE id = $2',
    [transcript, id]
  );
}

export async function getAudioChunks(sessionId: string): Promise<DbAudioChunk[]> {
  return getDb().select<DbAudioChunk[]>(
    'SELECT * FROM audio_chunks WHERE session_id = $1 ORDER BY start_time',
    [sessionId]
  );
}

// ============================================================================
// Insights
// ============================================================================

export async function createInsight(
  sessionId: string,
  type: DbInsight['type'],
  content: string,
  metadata?: Record<string, unknown>
): Promise<DbInsight> {
  const insight: DbInsight = {
    id: generateId(),
    session_id: sessionId,
    created_at: new Date().toISOString(),
    type,
    content,
    metadata: metadata ? JSON.stringify(metadata) : null,
    pinned: false,
  };

  await getDb().execute(
    `INSERT INTO insights (id, session_id, created_at, type, content, metadata, pinned)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [insight.id, insight.session_id, insight.created_at, insight.type, insight.content, insight.metadata, 0]
  );

  return insight;
}

export async function getInsights(
  sessionId: string,
  type?: DbInsight['type']
): Promise<DbInsight[]> {
  if (type) {
    return getDb().select<DbInsight[]>(
      'SELECT * FROM insights WHERE session_id = $1 AND type = $2 ORDER BY created_at DESC',
      [sessionId, type]
    );
  }
  return getDb().select<DbInsight[]>(
    'SELECT * FROM insights WHERE session_id = $1 ORDER BY created_at DESC',
    [sessionId]
  );
}

export async function pinInsight(id: string, pinned: boolean): Promise<void> {
  await getDb().execute(
    'UPDATE insights SET pinned = $1 WHERE id = $2',
    [pinned ? 1 : 0, id]
  );
}

// ============================================================================
// Rolling Summary
// ============================================================================

export async function getRollingSummary(sessionId: string): Promise<DbRollingSummary | null> {
  const result = await getDb().select<DbRollingSummary[]>(
    'SELECT * FROM rolling_summaries WHERE session_id = $1',
    [sessionId]
  );
  return result[0] || null;
}

export async function updateRollingSummary(
  sessionId: string,
  content: string
): Promise<void> {
  const now = new Date().toISOString();
  await getDb().execute(
    `UPDATE rolling_summaries
     SET content = $1, updated_at = $2, version = version + 1
     WHERE session_id = $3`,
    [content, now, sessionId]
  );
}

// ============================================================================
// Chat Messages
// ============================================================================

export async function saveChatMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  metadata?: Record<string, unknown>
): Promise<DbChatMessage> {
  const message: DbChatMessage = {
    id: generateId(),
    session_id: sessionId,
    created_at: new Date().toISOString(),
    role,
    content,
    metadata: metadata ? JSON.stringify(metadata) : null,
  };

  await getDb().execute(
    `INSERT INTO chat_messages (id, session_id, created_at, role, content, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [message.id, message.session_id, message.created_at, message.role, message.content, message.metadata]
  );

  return message;
}

export async function getChatHistory(sessionId: string): Promise<DbChatMessage[]> {
  return getDb().select<DbChatMessage[]>(
    'SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at',
    [sessionId]
  );
}

// ============================================================================
// Analysis State
// ============================================================================

export async function getAnalysisState(sessionId: string): Promise<DbAnalysisState | null> {
  const result = await getDb().select<DbAnalysisState[]>(
    'SELECT * FROM analysis_state WHERE session_id = $1',
    [sessionId]
  );
  return result[0] || null;
}

export async function updateAnalysisMode(
  sessionId: string,
  mode: 'ambient' | 'deep'
): Promise<void> {
  const now = new Date().toISOString();
  await getDb().execute(
    'UPDATE analysis_state SET mode = $1, updated_at = $2 WHERE session_id = $3',
    [mode, now, sessionId]
  );
  await getDb().execute(
    'UPDATE sessions SET analysis_mode = $1, updated_at = $2 WHERE id = $3',
    [mode, now, sessionId]
  );
}
```

**Step 3: Install the Tauri SQL plugin for TypeScript**

Run:
```bash
npm install @tauri-apps/plugin-sql
```

**Step 4: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

Expected: No errors

**Step 5: Commit**

```bash
git add src/services/database.ts src/types/database.ts package.json package-lock.json
git commit -m "feat: add SQLite database service for session intelligence"
```

---

## Phase 2: Bot Architecture

### Task 4: Create Session Intelligence Bots

**Files:**
- Create: `src/services/bots/types.ts`
- Create: `src/services/bots/summarizer.ts`
- Create: `src/services/bots/activity-detector.ts`
- Create: `src/services/bots/analysis-controller.ts`
- Create: `src/services/bots/qa-bot.ts`
- Create: `src/services/bots/index.ts`

**Step 1: Create bot types**

Create `src/services/bots/types.ts`:

```typescript
/**
 * Bot Types for Session Intelligence
 */

import { z } from 'zod';

// Activity detection output
export const ActivityDetectionSchema = z.object({
  hasSignificantChange: z.boolean(),
  currentApp: z.string().nullable(),
  currentContext: z.string(),
  activityType: z.enum(['coding', 'writing', 'browsing', 'designing', 'meeting', 'reading', 'unknown']),
  suggestedInsight: z.string().nullable(),
});

export type ActivityDetection = z.infer<typeof ActivityDetectionSchema>;

// Summary output
export const RollingSummarySchema = z.object({
  summary: z.string(),
  keyMoments: z.array(z.string()),
  currentFocus: z.string(),
});

export type RollingSummary = z.infer<typeof RollingSummarySchema>;

// Analysis mode decision
export const AnalysisModeDecisionSchema = z.object({
  recommendedMode: z.enum(['ambient', 'deep']),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
});

export type AnalysisModeDecision = z.infer<typeof AnalysisModeDecisionSchema>;

// Q&A response
export const QAResponseSchema = z.object({
  answer: z.string(),
  relevantMoments: z.array(z.object({
    timestamp: z.string(),
    description: z.string(),
  })).optional(),
  suggestedFollowUp: z.string().nullable(),
});

export type QAResponse = z.infer<typeof QAResponseSchema>;

// Session context for bots
export interface SessionContext {
  sessionId: string;
  rollingSummary: string;
  recentScreenshots: Array<{
    id: string;
    capturedAt: string;
    appName: string | null;
    windowTitle: string | null;
    analysis: string | null;
  }>;
  recentTranscripts: string[];
  recentInsights: string[];
  durationSeconds: number;
  analysisMode: 'ambient' | 'deep';
}
```

**Step 2: Create Summarizer Bot**

Create `src/services/bots/summarizer.ts`:

```typescript
/**
 * Summarizer Bot
 *
 * Maintains and updates the rolling summary as the session progresses.
 * Runs periodically and when significant changes are detected.
 */

import { Baleybot } from '@baleybots/core';
import { anthropic } from '@ai-sdk/anthropic';
import { RollingSummarySchema, type SessionContext } from './types';

const SYSTEM_PROMPT = `You are a session summarizer. Your job is to maintain a concise, evolving summary of a work session.

You receive:
- The current rolling summary (may be empty at start)
- Recent screenshot analyses describing what the user is doing
- Recent audio transcripts (if available)
- Recent insights already generated

Your output:
- An updated 2-4 sentence summary capturing the essence of the session so far
- Key moments worth highlighting (max 3-5 bullet points)
- The user's current focus in one phrase

Guidelines:
- Write in present tense for current activity, past tense for completed items
- Be specific about applications, documents, and activities when known
- Keep the summary coherent - it should read as a flowing narrative
- Don't just list activities; synthesize them into meaningful work description
- Each update should refine and extend, not replace entirely`;

export function createSummarizerBot() {
  return new Baleybot({
    name: 'summarizer',
    goal: 'Maintain a rolling summary of the session',
    model: anthropic('claude-sonnet-4-20250514'),
    outputSchema: RollingSummarySchema,
    systemPrompt: SYSTEM_PROMPT,
  });
}

export function buildSummarizerInput(context: SessionContext): string {
  const parts: string[] = [];

  parts.push(`## Current Session Duration: ${Math.floor(context.durationSeconds / 60)} minutes`);

  if (context.rollingSummary) {
    parts.push(`## Current Summary:\n${context.rollingSummary}`);
  } else {
    parts.push('## Current Summary:\n(Session just started)');
  }

  if (context.recentScreenshots.length > 0) {
    parts.push('## Recent Activity (from screenshots):');
    for (const ss of context.recentScreenshots) {
      const time = new Date(ss.capturedAt).toLocaleTimeString();
      const app = ss.appName || 'Unknown app';
      const analysis = ss.analysis || 'No analysis yet';
      parts.push(`- [${time}] ${app}: ${analysis}`);
    }
  }

  if (context.recentTranscripts.length > 0) {
    parts.push('## Recent Audio (transcribed):');
    parts.push(context.recentTranscripts.join('\n'));
  }

  if (context.recentInsights.length > 0) {
    parts.push('## Recent Insights:');
    parts.push(context.recentInsights.map(i => `- ${i}`).join('\n'));
  }

  parts.push('\nPlease update the rolling summary based on this information.');

  return parts.join('\n\n');
}
```

**Step 3: Create Activity Detector Bot**

Create `src/services/bots/activity-detector.ts`:

```typescript
/**
 * Activity Detector Bot
 *
 * Analyzes screenshots to detect what the user is doing,
 * identify context changes, and suggest insights.
 */

import { Baleybot } from '@baleybots/core';
import { anthropic } from '@ai-sdk/anthropic';
import { ActivityDetectionSchema } from './types';

const SYSTEM_PROMPT = `You are an activity detector analyzing screenshots from a work session.

For each screenshot, determine:
1. Has there been a significant change from the previous context?
2. What application/website is being used?
3. What is the user's current context (e.g., "editing React component", "reading documentation")
4. What type of activity is this?
5. Should we generate an insight card? Only if something notable happened.

Be concise but specific. Focus on what's useful for understanding the work session.`;

export function createActivityDetectorBot() {
  return new Baleybot({
    name: 'activity-detector',
    goal: 'Analyze screenshots to detect user activity and context changes',
    model: anthropic('claude-sonnet-4-20250514'),
    outputSchema: ActivityDetectionSchema,
    systemPrompt: SYSTEM_PROMPT,
  });
}

export function buildActivityDetectorInput(
  screenshotBase64: string,
  previousContext?: string
): Array<{ type: 'text' | 'image'; text?: string; image?: string }> {
  const content: Array<{ type: 'text' | 'image'; text?: string; image?: string }> = [];

  if (previousContext) {
    content.push({
      type: 'text',
      text: `Previous context: ${previousContext}\n\nAnalyze this new screenshot:`,
    });
  } else {
    content.push({
      type: 'text',
      text: 'Analyze this screenshot from the start of a work session:',
    });
  }

  content.push({
    type: 'image',
    image: screenshotBase64.replace(/^data:image\/\w+;base64,/, ''),
  });

  return content;
}
```

**Step 4: Create Analysis Controller Bot**

Create `src/services/bots/analysis-controller.ts`:

```typescript
/**
 * Analysis Controller Bot
 *
 * Monitors session intensity and decides when to escalate
 * or de-escalate analysis depth.
 */

import { Baleybot } from '@baleybots/core';
import { anthropic } from '@ai-sdk/anthropic';
import { AnalysisModeDecisionSchema, type SessionContext } from './types';

const SYSTEM_PROMPT = `You are an analysis controller that decides the appropriate analysis intensity for a work session.

Modes:
- **ambient**: Light analysis. Good for focused single-app work, quiet periods, or when the user is in flow.
- **deep**: Intensive real-time analysis. Good for complex multi-app workflows, meetings, rapid context switching.

Consider:
- How frequently is the user switching apps/contexts?
- Is there significant audio activity (meetings, calls)?
- How complex is the current workflow?
- Would more analysis help or just add noise?

Err toward ambient unless there's clear benefit from deep analysis.`;

export function createAnalysisControllerBot() {
  return new Baleybot({
    name: 'analysis-controller',
    goal: 'Decide optimal analysis intensity based on session activity',
    model: anthropic('claude-sonnet-4-20250514'),
    outputSchema: AnalysisModeDecisionSchema,
    systemPrompt: SYSTEM_PROMPT,
  });
}

export function buildAnalysisControllerInput(context: SessionContext): string {
  const parts: string[] = [];

  parts.push(`## Current Mode: ${context.analysisMode}`);
  parts.push(`## Session Duration: ${Math.floor(context.durationSeconds / 60)} minutes`);

  // Analyze screenshot frequency and diversity
  if (context.recentScreenshots.length > 0) {
    const apps = new Set(context.recentScreenshots.map(s => s.appName).filter(Boolean));
    parts.push(`## Recent Screenshots: ${context.recentScreenshots.length}`);
    parts.push(`## Unique Apps: ${apps.size} (${Array.from(apps).join(', ')})`);
  }

  // Check audio activity
  if (context.recentTranscripts.length > 0) {
    const wordCount = context.recentTranscripts.join(' ').split(/\s+/).length;
    parts.push(`## Recent Audio: ${wordCount} words transcribed`);
  } else {
    parts.push('## Recent Audio: None');
  }

  // Recent insights as indicator of activity
  parts.push(`## Recent Insights: ${context.recentInsights.length}`);

  parts.push('\nBased on this activity pattern, what analysis mode is appropriate?');

  return parts.join('\n');
}
```

**Step 5: Create Q&A Bot**

Create `src/services/bots/qa-bot.ts`:

```typescript
/**
 * Q&A Bot
 *
 * Answers user questions about their session using
 * all available context (screenshots, transcripts, insights).
 */

import { Baleybot } from '@baleybots/core';
import { anthropic } from '@ai-sdk/anthropic';
import { QAResponseSchema, type SessionContext } from './types';

const SYSTEM_PROMPT = `You are a helpful assistant that answers questions about a work session.

You have access to:
- A rolling summary of the session
- Recent screenshots with analysis
- Audio transcripts (if available)
- Generated insights

Answer questions naturally and helpfully. If you can reference specific moments or screenshots, do so.
If you don't have enough information to answer, say so honestly.

Keep responses concise but informative.`;

export function createQABot() {
  return new Baleybot({
    name: 'qa-bot',
    goal: 'Answer questions about the session',
    model: anthropic('claude-sonnet-4-20250514'),
    outputSchema: QAResponseSchema,
    systemPrompt: SYSTEM_PROMPT,
  });
}

export function buildQAInput(question: string, context: SessionContext): string {
  const parts: string[] = [];

  parts.push(`## Session Summary:\n${context.rollingSummary || 'No summary yet.'}`);
  parts.push(`## Duration: ${Math.floor(context.durationSeconds / 60)} minutes`);

  if (context.recentScreenshots.length > 0) {
    parts.push('## Recent Activity:');
    for (const ss of context.recentScreenshots.slice(0, 10)) {
      const time = new Date(ss.capturedAt).toLocaleTimeString();
      const app = ss.appName || 'Unknown';
      parts.push(`- [${time}] ${app}: ${ss.analysis || 'No analysis'}`);
    }
  }

  if (context.recentTranscripts.length > 0) {
    parts.push('## Recent Transcripts:');
    parts.push(context.recentTranscripts.slice(0, 5).join('\n'));
  }

  if (context.recentInsights.length > 0) {
    parts.push('## Key Insights:');
    parts.push(context.recentInsights.map(i => `- ${i}`).join('\n'));
  }

  parts.push(`\n## User Question:\n${question}`);

  return parts.join('\n\n');
}
```

**Step 6: Create bot index**

Create `src/services/bots/index.ts`:

```typescript
/**
 * Session Intelligence Bots
 *
 * Export all bots and their utilities.
 */

export * from './types';
export { createSummarizerBot, buildSummarizerInput } from './summarizer';
export { createActivityDetectorBot, buildActivityDetectorInput } from './activity-detector';
export { createAnalysisControllerBot, buildAnalysisControllerInput } from './analysis-controller';
export { createQABot, buildQAInput } from './qa-bot';
```

**Step 7: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

Expected: No errors (or only unrelated warnings)

**Step 8: Commit**

```bash
git add src/services/bots/
git commit -m "feat: add Baleybots session intelligence bots

- Summarizer: maintains rolling summary
- Activity Detector: analyzes screenshots
- Analysis Controller: manages analysis intensity
- Q&A Bot: answers questions about session"
```

---

## Phase 3: Session Coordinator

### Task 5: Create Session Coordinator Service

**Files:**
- Create: `src/services/session-coordinator.ts`

**Step 1: Create the coordinator**

Create `src/services/session-coordinator.ts`:

```typescript
/**
 * Session Coordinator
 *
 * Orchestrates all session intelligence:
 * - Manages bot lifecycle
 * - Routes data to appropriate bots
 * - Streams insights to UI
 * - Handles analysis mode switching
 */

import { EventEmitter } from './event-emitter';
import {
  createSummarizerBot,
  buildSummarizerInput,
  createActivityDetectorBot,
  buildActivityDetectorInput,
  createAnalysisControllerBot,
  buildAnalysisControllerInput,
  createQABot,
  buildQAInput,
  type SessionContext,
  type ActivityDetection,
  type RollingSummary,
  type AnalysisModeDecision,
} from './bots';
import {
  getSession,
  getScreenshots,
  getAudioChunks,
  getInsights,
  getRollingSummary,
  updateRollingSummary,
  createInsight,
  updateAnalysisMode,
  updateScreenshotAnalysis,
  saveChatMessage,
  getChatHistory,
  type DbScreenshot,
} from './database';

// Events emitted by the coordinator
export interface CoordinatorEvents {
  'summary-updated': { sessionId: string; summary: string };
  'insight-created': { sessionId: string; type: string; content: string };
  'mode-changed': { sessionId: string; mode: 'ambient' | 'deep'; reason: string };
  'activity-detected': { sessionId: string; activity: ActivityDetection };
  'chat-response': { sessionId: string; message: string };
  'error': { sessionId: string; error: string };
}

type EventCallback<K extends keyof CoordinatorEvents> = (data: CoordinatorEvents[K]) => void;

class SessionCoordinatorService {
  private emitter = new EventEmitter<CoordinatorEvents>();
  private activeSessions = new Map<string, {
    intervalId: ReturnType<typeof setInterval> | null;
    lastAnalysisCheck: number;
  }>();

  // Bot instances (created lazily)
  private summarizerBot = createSummarizerBot();
  private activityBot = createActivityDetectorBot();
  private analysisControllerBot = createAnalysisControllerBot();
  private qaBot = createQABot();

  /**
   * Subscribe to coordinator events
   */
  on<K extends keyof CoordinatorEvents>(event: K, callback: EventCallback<K>): () => void {
    return this.emitter.on(event, callback);
  }

  /**
   * Start coordinating a session
   */
  async startSession(sessionId: string): Promise<void> {
    if (this.activeSessions.has(sessionId)) {
      console.warn(`Session ${sessionId} already active`);
      return;
    }

    // Set up periodic analysis (every 30 seconds in ambient, every 10 in deep)
    const intervalId = setInterval(() => {
      this.runPeriodicAnalysis(sessionId);
    }, 30000);

    this.activeSessions.set(sessionId, {
      intervalId,
      lastAnalysisCheck: Date.now(),
    });

    console.log(`Session coordinator started for ${sessionId}`);
  }

  /**
   * Stop coordinating a session
   */
  async stopSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (session?.intervalId) {
      clearInterval(session.intervalId);
    }
    this.activeSessions.delete(sessionId);
    console.log(`Session coordinator stopped for ${sessionId}`);
  }

  /**
   * Process a new screenshot
   */
  async processScreenshot(sessionId: string, screenshot: DbScreenshot): Promise<void> {
    const context = await this.buildContext(sessionId);

    try {
      // Run activity detection
      const input = buildActivityDetectorInput(
        screenshot.data_base64,
        context.recentScreenshots[1]?.analysis || undefined
      );

      const result = await this.activityBot.process(input);

      // Update screenshot with analysis
      await updateScreenshotAnalysis(screenshot.id, result.currentContext);

      // Emit activity event
      this.emitter.emit('activity-detected', {
        sessionId,
        activity: result,
      });

      // Create insight if suggested
      if (result.suggestedInsight) {
        await createInsight(sessionId, 'moment', result.suggestedInsight);
        this.emitter.emit('insight-created', {
          sessionId,
          type: 'moment',
          content: result.suggestedInsight,
        });
      }

      // Check if we should update the summary
      if (result.hasSignificantChange) {
        await this.updateSummary(sessionId);
      }
    } catch (error) {
      console.error('Activity detection error:', error);
      this.emitter.emit('error', {
        sessionId,
        error: error instanceof Error ? error.message : 'Activity detection failed',
      });
    }
  }

  /**
   * Process an audio transcript
   */
  async processTranscript(sessionId: string, transcript: string): Promise<void> {
    // Transcripts trigger summary updates more frequently
    await this.updateSummary(sessionId);
  }

  /**
   * Handle a chat message from the user
   */
  async handleChatMessage(sessionId: string, message: string): Promise<string> {
    // Save user message
    await saveChatMessage(sessionId, 'user', message);

    const context = await this.buildContext(sessionId);

    try {
      const input = buildQAInput(message, context);
      const result = await this.qaBot.process(input);

      // Save assistant response
      await saveChatMessage(sessionId, 'assistant', result.answer);

      this.emitter.emit('chat-response', {
        sessionId,
        message: result.answer,
      });

      return result.answer;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to process question';
      this.emitter.emit('error', { sessionId, error: errorMsg });
      throw error;
    }
  }

  /**
   * Manually set analysis mode
   */
  async setAnalysisMode(sessionId: string, mode: 'ambient' | 'deep'): Promise<void> {
    await updateAnalysisMode(sessionId, mode);
    this.emitter.emit('mode-changed', {
      sessionId,
      mode,
      reason: 'Manual override',
    });
  }

  /**
   * Run periodic analysis tasks
   */
  private async runPeriodicAnalysis(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const context = await this.buildContext(sessionId);

    // Update summary periodically
    await this.updateSummary(sessionId);

    // Check if analysis mode should change (every 2 minutes)
    const now = Date.now();
    if (now - session.lastAnalysisCheck > 120000) {
      session.lastAnalysisCheck = now;
      await this.checkAnalysisMode(sessionId, context);
    }
  }

  /**
   * Update the rolling summary
   */
  private async updateSummary(sessionId: string): Promise<void> {
    const context = await this.buildContext(sessionId);

    try {
      const input = buildSummarizerInput(context);
      const result = await this.summarizerBot.process(input);

      await updateRollingSummary(sessionId, result.summary);

      this.emitter.emit('summary-updated', {
        sessionId,
        summary: result.summary,
      });
    } catch (error) {
      console.error('Summary update error:', error);
    }
  }

  /**
   * Check if analysis mode should change
   */
  private async checkAnalysisMode(sessionId: string, context: SessionContext): Promise<void> {
    try {
      const input = buildAnalysisControllerInput(context);
      const result = await this.analysisControllerBot.process(input);

      // Only change if confident and different from current
      if (result.confidence > 0.7 && result.recommendedMode !== context.analysisMode) {
        await updateAnalysisMode(sessionId, result.recommendedMode);
        this.emitter.emit('mode-changed', {
          sessionId,
          mode: result.recommendedMode,
          reason: result.reason,
        });
      }
    } catch (error) {
      console.error('Analysis mode check error:', error);
    }
  }

  /**
   * Build session context for bots
   */
  private async buildContext(sessionId: string): Promise<SessionContext> {
    const [session, screenshots, audioChunks, insights, summary] = await Promise.all([
      getSession(sessionId),
      getScreenshots(sessionId, 10),
      getAudioChunks(sessionId),
      getInsights(sessionId),
      getRollingSummary(sessionId),
    ]);

    if (!session) throw new Error(`Session not found: ${sessionId}`);

    return {
      sessionId,
      rollingSummary: summary?.content || '',
      recentScreenshots: screenshots.map(s => ({
        id: s.id,
        capturedAt: s.captured_at,
        appName: s.app_name,
        windowTitle: s.window_title,
        analysis: s.analysis,
      })),
      recentTranscripts: audioChunks
        .filter(c => c.transcript)
        .slice(-5)
        .map(c => c.transcript!),
      recentInsights: insights.slice(0, 10).map(i => i.content),
      durationSeconds: session.duration_seconds || 0,
      analysisMode: session.analysis_mode as 'ambient' | 'deep',
    };
  }
}

export const sessionCoordinator = new SessionCoordinatorService();
```

**Step 2: Create simple event emitter utility**

Create `src/services/event-emitter.ts`:

```typescript
/**
 * Simple typed event emitter
 */

type Listener<T> = (data: T) => void;

export class EventEmitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<Listener<unknown>>>();

  on<K extends keyof Events>(event: K, callback: Listener<Events[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback as Listener<unknown>);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(callback as Listener<unknown>);
    };
  }

  emit<K extends keyof Events>(event: K, data: Events[K]): void {
    this.listeners.get(event)?.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in event listener for ${String(event)}:`, error);
      }
    });
  }

  off<K extends keyof Events>(event: K, callback: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(callback as Listener<unknown>);
  }

  removeAllListeners(event?: keyof Events): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}
```

**Step 3: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/services/session-coordinator.ts src/services/event-emitter.ts
git commit -m "feat: add session coordinator service

Orchestrates all bot activity:
- Routes screenshots to activity detector
- Maintains rolling summary
- Handles chat Q&A
- Auto-adjusts analysis mode"
```

---

## Phase 4: React Integration

### Task 6: Create React Hooks for Session Intelligence

**Files:**
- Create: `src/hooks/useSessionIntelligence.ts`
- Create: `src/hooks/useSessionChat.ts`

**Step 1: Create session intelligence hook**

Create `src/hooks/useSessionIntelligence.ts`:

```typescript
/**
 * useSessionIntelligence Hook
 *
 * Connects React components to the session coordinator.
 * Provides real-time updates for summary, insights, and mode.
 */

import { useState, useEffect, useCallback } from 'react';
import { sessionCoordinator } from '../services/session-coordinator';
import { getRollingSummary, getInsights, getAnalysisState } from '../services/database';
import type { DbInsight } from '../types/database';

interface SessionIntelligenceState {
  summary: string;
  insights: DbInsight[];
  analysisMode: 'ambient' | 'deep';
  isLoading: boolean;
  error: string | null;
}

export function useSessionIntelligence(sessionId: string | null) {
  const [state, setState] = useState<SessionIntelligenceState>({
    summary: '',
    insights: [],
    analysisMode: 'ambient',
    isLoading: true,
    error: null,
  });

  // Load initial data
  useEffect(() => {
    if (!sessionId) {
      setState(s => ({ ...s, isLoading: false }));
      return;
    }

    async function loadInitialData() {
      try {
        const [summary, insights, analysisState] = await Promise.all([
          getRollingSummary(sessionId),
          getInsights(sessionId),
          getAnalysisState(sessionId),
        ]);

        setState({
          summary: summary?.content || '',
          insights,
          analysisMode: (analysisState?.mode as 'ambient' | 'deep') || 'ambient',
          isLoading: false,
          error: null,
        });
      } catch (error) {
        setState(s => ({
          ...s,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to load session data',
        }));
      }
    }

    loadInitialData();
  }, [sessionId]);

  // Subscribe to coordinator events
  useEffect(() => {
    if (!sessionId) return;

    const unsubSummary = sessionCoordinator.on('summary-updated', (data) => {
      if (data.sessionId === sessionId) {
        setState(s => ({ ...s, summary: data.summary }));
      }
    });

    const unsubInsight = sessionCoordinator.on('insight-created', async (data) => {
      if (data.sessionId === sessionId) {
        // Reload insights to get the new one
        const insights = await getInsights(sessionId);
        setState(s => ({ ...s, insights }));
      }
    });

    const unsubMode = sessionCoordinator.on('mode-changed', (data) => {
      if (data.sessionId === sessionId) {
        setState(s => ({ ...s, analysisMode: data.mode }));
      }
    });

    const unsubError = sessionCoordinator.on('error', (data) => {
      if (data.sessionId === sessionId) {
        setState(s => ({ ...s, error: data.error }));
      }
    });

    return () => {
      unsubSummary();
      unsubInsight();
      unsubMode();
      unsubError();
    };
  }, [sessionId]);

  // Actions
  const setAnalysisMode = useCallback(async (mode: 'ambient' | 'deep') => {
    if (!sessionId) return;
    await sessionCoordinator.setAnalysisMode(sessionId, mode);
  }, [sessionId]);

  const pinInsight = useCallback(async (insightId: string, pinned: boolean) => {
    if (!sessionId) return;
    const { pinInsight: dbPinInsight } = await import('../services/database');
    await dbPinInsight(insightId, pinned);
    const insights = await getInsights(sessionId);
    setState(s => ({ ...s, insights }));
  }, [sessionId]);

  return {
    ...state,
    setAnalysisMode,
    pinInsight,
  };
}
```

**Step 2: Create session chat hook**

Create `src/hooks/useSessionChat.ts`:

```typescript
/**
 * useSessionChat Hook
 *
 * Manages chat interactions with the session Q&A bot.
 */

import { useState, useEffect, useCallback } from 'react';
import { sessionCoordinator } from '../services/session-coordinator';
import { getChatHistory, type DbChatMessage } from '../services/database';

interface ChatState {
  messages: DbChatMessage[];
  isLoading: boolean;
  isSending: boolean;
  error: string | null;
}

export function useSessionChat(sessionId: string | null) {
  const [state, setState] = useState<ChatState>({
    messages: [],
    isLoading: true,
    isSending: false,
    error: null,
  });

  // Load chat history
  useEffect(() => {
    if (!sessionId) {
      setState(s => ({ ...s, isLoading: false }));
      return;
    }

    async function loadHistory() {
      try {
        const messages = await getChatHistory(sessionId);
        setState({
          messages,
          isLoading: false,
          isSending: false,
          error: null,
        });
      } catch (error) {
        setState(s => ({
          ...s,
          isLoading: false,
          error: error instanceof Error ? error.message : 'Failed to load chat history',
        }));
      }
    }

    loadHistory();
  }, [sessionId]);

  // Subscribe to chat responses
  useEffect(() => {
    if (!sessionId) return;

    const unsub = sessionCoordinator.on('chat-response', async (data) => {
      if (data.sessionId === sessionId) {
        // Reload messages to get the new response
        const messages = await getChatHistory(sessionId);
        setState(s => ({ ...s, messages, isSending: false }));
      }
    });

    return unsub;
  }, [sessionId]);

  // Send a message
  const sendMessage = useCallback(async (message: string) => {
    if (!sessionId || !message.trim()) return;

    setState(s => ({ ...s, isSending: true, error: null }));

    try {
      // Optimistically add user message
      const messages = await getChatHistory(sessionId);
      setState(s => ({ ...s, messages }));

      // Send to coordinator (response will come via event)
      await sessionCoordinator.handleChatMessage(sessionId, message);
    } catch (error) {
      setState(s => ({
        ...s,
        isSending: false,
        error: error instanceof Error ? error.message : 'Failed to send message',
      }));
    }
  }, [sessionId]);

  const clearError = useCallback(() => {
    setState(s => ({ ...s, error: null }));
  }, []);

  return {
    ...state,
    sendMessage,
    clearError,
  };
}
```

**Step 3: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/hooks/useSessionIntelligence.ts src/hooks/useSessionChat.ts
git commit -m "feat: add React hooks for session intelligence

- useSessionIntelligence: real-time summary, insights, mode
- useSessionChat: chat with Q&A bot about session"
```

---

### Task 7: Initialize Database on App Start

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/context/AppContext.tsx`

**Step 1: Add database initialization to AppContext**

In `src/context/AppContext.tsx`, add at the top after imports:

```typescript
import { initDatabase } from '../services/database';
```

In the `AppProvider` component, add a useEffect to initialize the database:

```typescript
// Inside AppProvider, before the return statement:
const [dbReady, setDbReady] = useState(false);

useEffect(() => {
  initDatabase()
    .then(() => setDbReady(true))
    .catch(err => console.error('Database init failed:', err));
}, []);
```

Wrap the children with a loading check:

```typescript
// In the return statement:
return (
  <AppContext.Provider value={{ state, dispatch, addSession, deleteSession }}>
    {dbReady ? children : <div>Loading...</div>}
  </AppContext.Provider>
);
```

**Step 2: Verify app still works**

Run:
```bash
npm run dev
```

Check the browser console for "Database initialized" message.

**Step 3: Commit**

```bash
git add src/context/AppContext.tsx
git commit -m "feat: initialize database on app start"
```

---

## Phase 5: Smart Capture Integration

### Task 8: Connect Recording to Session Coordinator

**Files:**
- Modify: `src/services/recording.ts`
- Modify: `src/components/SessionRecording.tsx`

**Step 1: Update recording service to save to database**

In `src/services/recording.ts`, add imports at the top:

```typescript
import { saveScreenshot, saveAudioChunk } from './database';
import { sessionCoordinator } from './session-coordinator';
```

Modify `captureAndStoreScreenshot` method in `SessionRecordingController`:

```typescript
private async captureAndStoreScreenshot(): Promise<void> {
  if (!this.state || !isTauri()) return;

  try {
    const screenshot = await captureScreenshot(this.state.options.selectedScreen);
    this.state.screenshots.push(screenshot);

    // Save to database
    const dbScreenshot = await saveScreenshot(
      this.state.sessionId,
      screenshot,
      'interval' // TODO: detect actual trigger
    );

    // Notify coordinator for analysis
    sessionCoordinator.processScreenshot(this.state.sessionId, dbScreenshot);

    console.log(`📸 Screenshot captured (${this.state.screenshots.length} total)`);
  } catch (e) {
    console.error('Failed to capture screenshot:', e);
  }
}
```

**Step 2: Update SessionRecording component to use coordinator**

In `src/components/SessionRecording.tsx`, add to the initRecording function after starting the recorder:

```typescript
// After: await sessionRecorder.startRecording(sessionIdRef.current, recordingOptions)
// Add:
import { sessionCoordinator } from '../services/session-coordinator';
import { createSession } from '../services/database';

// In initRecording, after starting recording:
// Create database session
await createSession('session', sessionTitle, 'ambient');

// Start coordinator
await sessionCoordinator.startSession(sessionIdRef.current);
```

In the cleanup and handleEndSession, stop the coordinator:

```typescript
// In cleanup:
sessionCoordinator.stopSession(sessionIdRef.current);

// In handleEndSession, before stopping the recorder:
await sessionCoordinator.stopSession(sessionIdRef.current);
```

**Step 3: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add src/services/recording.ts src/components/SessionRecording.tsx
git commit -m "feat: connect recording to session coordinator

Screenshots saved to database and analyzed by bots"
```

---

## Verification

### Task 9: End-to-End Test

**Step 1: Run the app**

```bash
npm run tauri dev
```

**Step 2: Start a recording session**

1. Click "Record a Session"
2. Configure settings (enable screenshots)
3. Start recording
4. Wait for 30 seconds to see a screenshot captured

**Step 3: Verify in console**

Look for:
- "Database initialized"
- "Session coordinator started for [id]"
- "📸 Screenshot captured"
- Activity detection results

**Step 4: End session and verify summary**

Stop the recording and check that a summary is generated.

---

## Summary

This plan implements:

1. **Baleybots SDK integration** - Core, Chat, and React packages
2. **SQLite database** - Full schema for sessions, screenshots, audio, insights, chat
3. **Bot hierarchy** - Summarizer, Activity Detector, Analysis Controller, Q&A Bot
4. **Session Coordinator** - Orchestrates all bot activity
5. **React hooks** - `useSessionIntelligence` and `useSessionChat`
6. **Smart capture** - Screenshots saved to DB and analyzed

**Not included (future work):**
- UI components for the intelligence panel
- Peripheral glow visualization
- Event-driven capture triggers
- Audio transcription integration
- Real-time streaming to UI

---

## Next Steps

After backend is complete, the next plan should cover:
1. Intelligence Panel UI component
2. Peripheral glow audio visualization
3. Editorial marginalia cards
4. Rolling summary card with chat expansion
5. Timeline component with thumbnails
