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
let initPromise: Promise<void> | null = null;

const SCHEMA = `
-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('session', 'capture')),
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  duration_seconds INTEGER,
  status TEXT NOT NULL DEFAULT 'recording' CHECK (status IN ('recording', 'processing', 'complete', 'error', 'interrupted')),
  analysis_mode TEXT NOT NULL DEFAULT 'ambient' CHECK (analysis_mode IN ('ambient', 'deep'))
);

-- Screenshots table
CREATE TABLE IF NOT EXISTS screenshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('interval', 'app_switch', 'activity', 'manual', 'session_start', 'session_end')),
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
 * Uses a promise lock to prevent concurrent initialization
 */
export async function initDatabase(): Promise<void> {
  // Already initialized
  if (db) return;

  // Use existing promise if initialization in progress (prevents race condition)
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      console.log('[DATABASE] Initializing SQLite database...');
      db = await Database.load('sqlite:sessions.db');
      console.log('[DATABASE] Database connection established');

      // Enable foreign key constraints (required for CASCADE deletes to work)
      await db.execute('PRAGMA foreign_keys = ON');
      console.log('[DATABASE] Foreign key constraints enabled');

      // Create tables
      const statements = SCHEMA.split(';').filter(s => s.trim());
      for (const statement of statements) {
        await db.execute(statement);
      }

      console.log('[DATABASE] Schema initialized successfully');
    } catch (error) {
      console.error('[DATABASE] Failed to initialize database:', error);
      db = null;
      // Re-throw with more context
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Database initialization failed: ${message}. Make sure you're running the app with 'npm run tauri dev'.`);
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

/**
 * Ensure database is initialized and return it
 * This is the preferred method to get the database instance
 */
export async function ensureDb(): Promise<Database> {
  if (!db) {
    await initDatabase();
  }
  if (!db) {
    throw new Error('Database initialization failed');
  }
  return db;
}

/**
 * Get the database instance synchronously
 * Only use this when you're certain the database is initialized
 * Prefer ensureDb() for new code
 */
export function getDb(): Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

// ============================================================================
// Sessions
// ============================================================================

export async function createSession(
  id: string,
  type: 'session' | 'capture',
  title: string,
  analysisMode: 'ambient' | 'deep' = 'ambient'
): Promise<DbSession> {
  const db = await ensureDb();
  const now = new Date().toISOString();
  const session: DbSession = {
    id,
    type,
    title,
    created_at: now,
    updated_at: now,
    duration_seconds: null,
    status: 'recording',
    analysis_mode: analysisMode,
  };

  // Use transaction to ensure all inserts succeed or none do
  try {
    await db.execute('BEGIN TRANSACTION');

    await db.execute(
      `INSERT INTO sessions (id, type, title, created_at, updated_at, status, analysis_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [session.id, session.type, session.title, session.created_at, session.updated_at, session.status, session.analysis_mode]
    );

    // Initialize analysis state
    await db.execute(
      `INSERT INTO analysis_state (session_id, mode, updated_at)
       VALUES ($1, $2, $3)`,
      [session.id, analysisMode, now]
    );

    // Initialize rolling summary
    await db.execute(
      `INSERT INTO rolling_summaries (id, session_id, updated_at, content, version)
       VALUES ($1, $2, $3, $4, $5)`,
      [generateId(), session.id, now, '', 1]
    );

    await db.execute('COMMIT');
  } catch (error) {
    await db.execute('ROLLBACK');
    console.error('[DATABASE] Failed to create session, rolled back:', error);
    throw error;
  }

  return session;
}

export async function getSession(id: string): Promise<DbSession | null> {
  const db = await ensureDb();
  const result = await db.select<DbSession[]>(
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
  const db = await ensureDb();
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE sessions SET status = $1, duration_seconds = $2, updated_at = $3 WHERE id = $4`,
    [status, durationSeconds ?? null, now, id]
  );
}

// ============================================================================
// Screenshots
// ============================================================================

// Maximum sizes for base64 data (in bytes)
const MAX_SCREENSHOT_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_AUDIO_CHUNK_SIZE = 50 * 1024 * 1024; // 50MB

export async function saveScreenshot(
  sessionId: string,
  dataBase64: string,
  trigger: DbScreenshot['trigger'],
  appName?: string,
  windowTitle?: string
): Promise<DbScreenshot> {
  // Validate base64 data size
  if (dataBase64.length > MAX_SCREENSHOT_SIZE) {
    console.error(`[DATABASE] Screenshot too large: ${dataBase64.length} bytes (max: ${MAX_SCREENSHOT_SIZE})`);
    throw new Error(`Screenshot too large (${Math.round(dataBase64.length / 1024 / 1024)}MB). Max size is 10MB.`);
  }

  const db = await ensureDb();
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

  await db.execute(
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
  const db = await ensureDb();
  const query = limit
    ? 'SELECT * FROM screenshots WHERE session_id = $1 ORDER BY captured_at ASC LIMIT $2'
    : 'SELECT * FROM screenshots WHERE session_id = $1 ORDER BY captured_at ASC';
  const params = limit ? [sessionId, limit] : [sessionId];
  return db.select<DbScreenshot[]>(query, params);
}

export async function updateScreenshotAnalysis(
  id: string,
  analysis: string
): Promise<void> {
  const db = await ensureDb();
  await db.execute(
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
  // Validate base64 data size
  if (dataBase64.length > MAX_AUDIO_CHUNK_SIZE) {
    console.error(`[DATABASE] Audio chunk too large: ${dataBase64.length} bytes (max: ${MAX_AUDIO_CHUNK_SIZE})`);
    throw new Error(`Audio chunk too large (${Math.round(dataBase64.length / 1024 / 1024)}MB). Max size is 50MB.`);
  }

  const db = await ensureDb();
  const chunk: DbAudioChunk = {
    id: generateId(),
    session_id: sessionId,
    start_time: startTime,
    end_time: endTime,
    duration_seconds: durationSeconds,
    data_base64: dataBase64,
    transcript: null,
  };

  await db.execute(
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
  const db = await ensureDb();
  await db.execute(
    'UPDATE audio_chunks SET transcript = $1 WHERE id = $2',
    [transcript, id]
  );
}

export async function getAudioChunks(sessionId: string): Promise<DbAudioChunk[]> {
  const db = await ensureDb();
  return db.select<DbAudioChunk[]>(
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
  const db = await ensureDb();
  const insight: DbInsight = {
    id: generateId(),
    session_id: sessionId,
    created_at: new Date().toISOString(),
    type,
    content,
    metadata: metadata ? JSON.stringify(metadata) : null,
    pinned: false,
  };

  await db.execute(
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
  const db = await ensureDb();
  if (type) {
    return db.select<DbInsight[]>(
      'SELECT * FROM insights WHERE session_id = $1 AND type = $2 ORDER BY created_at DESC',
      [sessionId, type]
    );
  }
  return db.select<DbInsight[]>(
    'SELECT * FROM insights WHERE session_id = $1 ORDER BY created_at DESC',
    [sessionId]
  );
}

export async function pinInsight(id: string, pinned: boolean): Promise<void> {
  const db = await ensureDb();
  await db.execute(
    'UPDATE insights SET pinned = $1 WHERE id = $2',
    [pinned ? 1 : 0, id]
  );
}

// ============================================================================
// Rolling Summary
// ============================================================================

export async function getRollingSummary(sessionId: string): Promise<DbRollingSummary | null> {
  const db = await ensureDb();
  const result = await db.select<DbRollingSummary[]>(
    'SELECT * FROM rolling_summaries WHERE session_id = $1',
    [sessionId]
  );
  return result[0] || null;
}

export async function updateRollingSummary(
  sessionId: string,
  content: string
): Promise<void> {
  const db = await ensureDb();
  const now = new Date().toISOString();

  // Use INSERT OR REPLACE to handle race condition where
  // rolling_summary may not exist yet
  await db.execute(
    `INSERT INTO rolling_summaries (id, session_id, updated_at, content, version)
     VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT(session_id) DO UPDATE SET
       content = excluded.content,
       updated_at = excluded.updated_at,
       version = version + 1`,
    [generateId(), sessionId, now, content]
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
  const db = await ensureDb();
  const message: DbChatMessage = {
    id: generateId(),
    session_id: sessionId,
    created_at: new Date().toISOString(),
    role,
    content,
    metadata: metadata ? JSON.stringify(metadata) : null,
  };

  await db.execute(
    `INSERT INTO chat_messages (id, session_id, created_at, role, content, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [message.id, message.session_id, message.created_at, message.role, message.content, message.metadata]
  );

  return message;
}

export async function getChatHistory(sessionId: string): Promise<DbChatMessage[]> {
  const db = await ensureDb();
  return db.select<DbChatMessage[]>(
    'SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY created_at',
    [sessionId]
  );
}

// ============================================================================
// Analysis State
// ============================================================================

export async function getAnalysisState(sessionId: string): Promise<DbAnalysisState | null> {
  const db = await ensureDb();
  const result = await db.select<DbAnalysisState[]>(
    'SELECT * FROM analysis_state WHERE session_id = $1',
    [sessionId]
  );
  return result[0] || null;
}

export async function updateAnalysisMode(
  sessionId: string,
  mode: 'ambient' | 'deep'
): Promise<void> {
  const db = await ensureDb();
  const now = new Date().toISOString();
  await db.execute(
    'UPDATE analysis_state SET mode = $1, updated_at = $2 WHERE session_id = $3',
    [mode, now, sessionId]
  );
  await db.execute(
    'UPDATE sessions SET analysis_mode = $1, updated_at = $2 WHERE id = $3',
    [mode, now, sessionId]
  );
}

// ============================================================================
// Session Cleanup
// ============================================================================

/**
 * Delete all session data from database
 * Uses a transaction to ensure all deletes succeed or none do
 * Note: With foreign_keys=ON and CASCADE, deleting the session should cascade to related tables,
 * but we explicitly delete to ensure cleanup even if CASCADE fails
 */
export async function deleteSessionData(sessionId: string): Promise<void> {
  const db = await ensureDb();

  try {
    await db.execute('BEGIN TRANSACTION');

    // Delete in order to respect foreign key constraints (if CASCADE isn't working)
    await db.execute('DELETE FROM chat_messages WHERE session_id = $1', [sessionId]);
    await db.execute('DELETE FROM insights WHERE session_id = $1', [sessionId]);
    await db.execute('DELETE FROM rolling_summaries WHERE session_id = $1', [sessionId]);
    await db.execute('DELETE FROM analysis_state WHERE session_id = $1', [sessionId]);
    await db.execute('DELETE FROM audio_chunks WHERE session_id = $1', [sessionId]);
    await db.execute('DELETE FROM screenshots WHERE session_id = $1', [sessionId]);
    await db.execute('DELETE FROM sessions WHERE id = $1', [sessionId]);

    await db.execute('COMMIT');
    console.log('[DATABASE] Deleted session data:', sessionId);
  } catch (error) {
    await db.execute('ROLLBACK');
    console.error('[DATABASE] Failed to delete session, rolled back:', error);
    throw error;
  }
}

// ============================================================================
// Crash Recovery
// ============================================================================

/**
 * Find sessions that were interrupted (recording/processing status)
 * These need recovery or cleanup
 */
export async function findOrphanedSessions(): Promise<DbSession[]> {
  const db = await ensureDb();
  const result = await db.select<DbSession[]>(
    "SELECT * FROM sessions WHERE status IN ('recording', 'processing') ORDER BY created_at DESC"
  );
  return result;
}

/**
 * Mark orphaned sessions as needing recovery
 */
export async function markSessionsAsInterrupted(sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return;

  const db = await ensureDb();
  const placeholders = sessionIds.map((_, i) => `$${i + 1}`).join(', ');
  await db.execute(
    `UPDATE sessions SET status = 'interrupted' WHERE id IN (${placeholders})`,
    sessionIds
  );
  console.log(`[DATABASE] Marked ${sessionIds.length} sessions as interrupted`);
}

// ============================================================================
// localStorage Sync
// ============================================================================

/**
 * Get all complete sessions from database for localStorage sync
 */
export async function getAllCompleteSessions(): Promise<DbSession[]> {
  const db = await ensureDb();
  return await db.select<DbSession[]>(
    "SELECT * FROM sessions WHERE status = 'complete' ORDER BY created_at DESC"
  );
}
