/**
 * Database Service
 *
 * SQLite-based storage for session intelligence data.
 * Uses tauri-plugin-sql for native database access.
 */

import Database from '@tauri-apps/plugin-sql';
import { generateId } from '../utils/id';
import { validateSummary, validateAttachments } from '../utils/validate';
import type { Summary, Attachment } from '../types';
import type {
  DbSession,
  DbScreenshot,
  DbAudioChunk,
  DbInsight,
  DbRollingSummary,
  DbChatMessage,
  DbAnalysisState,
} from '../types/database';
import { saveScreenshotToFile, deleteSessionScreenshots } from './screenshot-storage';
import { deleteSessionAudio } from './audio-storage';
import { logger } from '../utils/logger';

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
  video_path TEXT,
  status TEXT NOT NULL DEFAULT 'recording' CHECK (status IN ('recording', 'processing', 'complete', 'error', 'interrupted')),
  analysis_mode TEXT NOT NULL DEFAULT 'ambient' CHECK (analysis_mode IN ('ambient', 'deep'))
);

-- Screenshots table
-- file_path stores the path to the screenshot file on disk (required)
CREATE TABLE IF NOT EXISTS screenshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('interval', 'app_switch', 'activity', 'manual', 'session_start', 'session_end')),
  app_name TEXT,
  window_title TEXT,
  file_path TEXT NOT NULL,
  analysis TEXT
);
CREATE INDEX IF NOT EXISTS idx_screenshots_session ON screenshots(session_id);
CREATE INDEX IF NOT EXISTS idx_screenshots_time ON screenshots(captured_at);

-- Audio chunks table
-- file_path stores the path to the audio file on disk (required)
CREATE TABLE IF NOT EXISTS audio_chunks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  duration_seconds REAL NOT NULL,
  file_path TEXT NOT NULL,
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

-- Final session summaries (JSON payload)
CREATE TABLE IF NOT EXISTS session_summaries (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL,
  summary_json TEXT NOT NULL
);

-- Capture payloads (text + attachment metadata)
CREATE TABLE IF NOT EXISTS capture_payloads (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  text TEXT,
  attachments_json TEXT
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
      logger.info('[DATABASE] Initializing SQLite database...');
      db = await Database.load('sqlite:sessions.db');
      logger.info('[DATABASE] Database connection established');

      // Quick integrity check
      try {
        await db.select<Array<{ integrity_check: string }>>('PRAGMA integrity_check');
      } catch (integrityError) {
        logger.error('[DATABASE] Database integrity check failed:', integrityError);
        db = null;
        throw new Error('Database appears corrupted. Please contact support or delete the database file to start fresh.');
      }

      // Enable foreign key constraints (required for CASCADE deletes to work)
      await db.execute('PRAGMA foreign_keys = ON');

      // Performance optimizations for write-heavy workloads (screenshots, audio)
      // WAL mode allows concurrent reads during writes
      await db.execute('PRAGMA journal_mode = WAL');
      // NORMAL sync is safe for most use cases and much faster than FULL
      await db.execute('PRAGMA synchronous = NORMAL');
      // Larger cache reduces disk I/O
      await db.execute('PRAGMA cache_size = 10000');
      logger.debug('[DATABASE] Foreign key constraints and performance optimizations enabled');

      // Create tables
      const statements = SCHEMA.split(';').filter(s => s.trim());
      for (const statement of statements) {
        await db.execute(statement);
      }

      logger.info('[DATABASE] Schema initialized successfully');
    } catch (error) {
      logger.error('[DATABASE] Failed to initialize database:', error);
      db = null;
      // Re-throw with actionable error messages
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('disk') || message.includes('full')) {
        throw new Error('Disk is full. Free up space and restart the app.');
      } else if (message.includes('locked') || message.includes('busy')) {
        throw new Error('Database is locked by another process. Close other instances and retry.');
      } else if (message.includes('corrupt')) {
        throw new Error('Database appears corrupted. Please contact support or delete the database file to start fresh.');
      } else {
        throw new Error(`Database initialization failed: ${message}`);
      }
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
    video_path: null,
    status: 'recording',
    analysis_mode: analysisMode,
  };

  // Insert session and related records in a transaction for consistency
  try {
    await db.execute('BEGIN TRANSACTION');

    await db.execute(
      `INSERT INTO sessions (id, type, title, created_at, updated_at, status, analysis_mode, video_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        session.id,
        session.type,
        session.title,
        session.created_at,
        session.updated_at,
        session.status,
        session.analysis_mode,
        session.video_path,
      ]
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
    await db.execute('ROLLBACK').catch(() => {});
    logger.error('[DATABASE] Failed to create session, rolled back:', error);
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

export async function updateSessionTitle(
  id: string,
  title: string
): Promise<void> {
  const db = await ensureDb();
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE sessions SET title = $1, updated_at = $2 WHERE id = $3`,
    [title, now, id]
  );
}

export async function updateSessionVideoPath(
  id: string,
  videoPath: string | null
): Promise<void> {
  const db = await ensureDb();
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE sessions SET video_path = $1, updated_at = $2 WHERE id = $3`,
    [videoPath, now, id]
  );
}

// ============================================================================
// Screenshots
// ============================================================================

/**
 * Save a screenshot to file storage
 *
 * This function:
 * 1. Saves screenshot to file (source of truth)
 * 2. Stores file_path in DB
 * 3. Returns screenshot object for AI analysis (caller has base64)
 */
export async function saveScreenshot(
  sessionId: string,
  dataBase64: string,
  trigger: DbScreenshot['trigger'],
  appName?: string,
  windowTitle?: string
): Promise<DbScreenshot> {
  const db = await ensureDb();
  const screenshotId = generateId();
  const capturedAt = new Date().toISOString();

  // Save to file - this is the source of truth
  const filePath = await saveScreenshotToFile(sessionId, screenshotId, dataBase64);

  // Create screenshot object
  const screenshot: DbScreenshot = {
    id: screenshotId,
    session_id: sessionId,
    captured_at: capturedAt,
    trigger,
    app_name: appName ?? null,
    window_title: windowTitle ?? null,
    file_path: filePath,
    analysis: null,
  };

  // Insert with file_path only - fast, small write
  await db.execute(
    `INSERT INTO screenshots (id, session_id, captured_at, trigger, app_name, window_title, file_path)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [screenshot.id, screenshot.session_id, screenshot.captured_at, screenshot.trigger, screenshot.app_name, screenshot.window_title, screenshot.file_path]
  );

  logger.debug(`[DATABASE] Screenshot saved: ${filePath} (${Math.round(dataBase64.length / 1024)}KB)`);
  return screenshot;
}

/**
 * Get screenshots for a session
 *
 * Returns screenshot metadata. Image data is loaded from file_path
 * using loadScreenshotData() from screenshot-storage.ts.
 */
export async function getScreenshots(
  sessionId: string,
  limit?: number
): Promise<DbScreenshot[]> {
  const db = await ensureDb();

  const query = limit
    ? `SELECT * FROM screenshots WHERE session_id = $1 ORDER BY captured_at ASC LIMIT $2`
    : `SELECT * FROM screenshots WHERE session_id = $1 ORDER BY captured_at ASC`;
  const params = limit ? [sessionId, limit] : [sessionId];

  return db.select<DbScreenshot[]>(query, params);
}

/**
 * Get a single screenshot by ID
 */
export async function getScreenshotById(id: string): Promise<DbScreenshot | null> {
  const db = await ensureDb();

  const result = await db.select<DbScreenshot[]>(
    `SELECT * FROM screenshots WHERE id = $1`,
    [id]
  );

  return result[0] || null;
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

/**
 * Save an audio chunk with file path (new file-based storage)
 *
 * @param sessionId - Session ID
 * @param chunkId - Chunk ID (from Rust, e.g., "chunk_0001")
 * @param filePath - Path to the WAV file on disk
 * @param startTime - ISO timestamp when chunk started
 * @param endTime - ISO timestamp when chunk ended
 * @param durationSeconds - Duration in seconds
 */
export async function saveAudioChunk(
  sessionId: string,
  chunkId: string,
  filePath: string,
  startTime: string,
  endTime: string,
  durationSeconds: number
): Promise<DbAudioChunk> {
  const db = await ensureDb();
  const chunk: DbAudioChunk = {
    id: chunkId,
    session_id: sessionId,
    start_time: startTime,
    end_time: endTime,
    duration_seconds: durationSeconds,
    file_path: filePath,
    transcript: null,
  };

  await db.execute(
    `INSERT INTO audio_chunks (id, session_id, start_time, end_time, duration_seconds, file_path)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [chunk.id, chunk.session_id, chunk.start_time, chunk.end_time, chunk.duration_seconds, chunk.file_path]
  );

  logger.debug(`[DATABASE] Audio chunk saved: ${filePath} (${durationSeconds.toFixed(1)}s)`);
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
// Final Summary
// ============================================================================

export async function saveSessionSummary(
  sessionId: string,
  summary: Summary
): Promise<void> {
  const db = await ensureDb();
  const now = new Date().toISOString();
  const summaryJson = JSON.stringify(summary);

  await db.execute(
    `INSERT INTO session_summaries (session_id, updated_at, summary_json)
     VALUES ($1, $2, $3)
     ON CONFLICT(session_id) DO UPDATE SET
       summary_json = excluded.summary_json,
       updated_at = excluded.updated_at`,
    [sessionId, now, summaryJson]
  );
}

export async function getSessionSummary(sessionId: string): Promise<Summary | null> {
  const db = await ensureDb();
  const result = await db.select<Array<{ summary_json: string }>>(
    'SELECT summary_json FROM session_summaries WHERE session_id = $1',
    [sessionId]
  );
  if (!result[0]?.summary_json) return null;

  try {
    return validateSummary(JSON.parse(result[0].summary_json));
  } catch {
    return null;
  }
}

// ============================================================================
// Capture Payloads
// ============================================================================

export async function saveCapturePayload(
  sessionId: string,
  text: string,
  attachments?: Attachment[]
): Promise<void> {
  const db = await ensureDb();
  const attachmentsJson = attachments ? JSON.stringify(attachments) : null;

  await db.execute(
    `INSERT INTO capture_payloads (session_id, text, attachments_json)
     VALUES ($1, $2, $3)
     ON CONFLICT(session_id) DO UPDATE SET
       text = excluded.text,
       attachments_json = excluded.attachments_json`,
    [sessionId, text, attachmentsJson]
  );
}

export async function getCapturePayload(sessionId: string): Promise<{ text: string; attachments: Attachment[] } | null> {
  const db = await ensureDb();
  const result = await db.select<Array<{ text: string | null; attachments_json: string | null }>>(
    'SELECT text, attachments_json FROM capture_payloads WHERE session_id = $1',
    [sessionId]
  );
  if (!result[0]) return null;

  let attachments: Attachment[] = [];
  if (result[0].attachments_json) {
    try {
      attachments = validateAttachments(JSON.parse(result[0].attachments_json));
    } catch {
      attachments = [];
    }
  }

  return {
    text: result[0].text ?? '',
    attachments,
  };
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
 * Delete all session data from database and files
 * Uses a transaction to ensure all deletes succeed or none do
 * Note: With foreign_keys=ON and CASCADE, deleting the session should cascade to related tables,
 * but we explicitly delete to ensure cleanup even if CASCADE fails
 */
export async function deleteSessionData(sessionId: string): Promise<void> {
  const db = await ensureDb();

  try {
    await db.execute('BEGIN TRANSACTION');

    // Delete in order to respect foreign key constraints (if CASCADE isn't working)
    await db.execute('DELETE FROM capture_payloads WHERE session_id = $1', [sessionId]);
    await db.execute('DELETE FROM chat_messages WHERE session_id = $1', [sessionId]);
    await db.execute('DELETE FROM insights WHERE session_id = $1', [sessionId]);
    await db.execute('DELETE FROM session_summaries WHERE session_id = $1', [sessionId]);
    await db.execute('DELETE FROM rolling_summaries WHERE session_id = $1', [sessionId]);
    await db.execute('DELETE FROM analysis_state WHERE session_id = $1', [sessionId]);
    await db.execute('DELETE FROM audio_chunks WHERE session_id = $1', [sessionId]);
    await db.execute('DELETE FROM screenshots WHERE session_id = $1', [sessionId]);
    await db.execute('DELETE FROM sessions WHERE id = $1', [sessionId]);

    await db.execute('COMMIT');
    logger.info('[DATABASE] Deleted session data:', sessionId);

    // Also delete media files (async, non-critical)
    deleteSessionScreenshots(sessionId).catch(err => {
      logger.warn('[DATABASE] Failed to delete screenshot files:', err);
    });
    deleteSessionAudio(sessionId).catch(err => {
      logger.warn('[DATABASE] Failed to delete audio files:', err);
    });
  } catch (error) {
    await db.execute('ROLLBACK');
    logger.error('[DATABASE] Failed to delete session, rolled back:', error);
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
  logger.info(`[DATABASE] Marked ${sessionIds.length} sessions as interrupted`);
}

/**
 * Get all sessions for UI sync (includes interrupted/error sessions)
 */
export async function getAllSessionsForSync(): Promise<DbSession[]> {
  const db = await ensureDb();
  return await db.select<DbSession[]>(
    "SELECT * FROM sessions WHERE status IN ('complete', 'interrupted', 'error', 'processing') ORDER BY created_at DESC"
  );
}
