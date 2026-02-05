/**
 * Worker Message Types
 *
 * Type definitions for communication between main thread and AI Worker.
 * All messages are serializable for postMessage transport.
 *
 * v2 Changes:
 * - Added id and timestamp to all messages for correlation
 * - Added state-change and progress response types
 *
 * v3 Changes:
 * - Removed isTauri and tauriProxyUrl - workers use native fetch with CORS headers
 */

import type { ActivityDetection, RollingSummary, CaptureTimingDecision } from '../bots/types';
import type { WorkerState } from './worker-state';

// ============================================================================
// Main Thread → Worker Messages
// ============================================================================

/** Base fields for all messages */
interface BaseMessage {
  /** Unique message ID for request/response correlation */
  id: string;
  /** Timestamp when message was created */
  timestamp: number;
}

export type WorkerMessage =
  | (BaseMessage & {
      type: 'init';
      anthropicKey: string;
      openaiKey: string | null;
    })
  | (BaseMessage & {
      type: 'analyze-screenshot';
      sessionId: string;
      screenshotId: string;
      imageBase64: string;
      trigger: string;
      previousAnalysis: string | null;
    })
  | (BaseMessage & {
      type: 'analyze-screenshot-binary';
      sessionId: string;
      screenshotId: string;
      imageData: ArrayBuffer; // Transferred, not copied
      trigger: string;
      previousAnalysis: string | null;
    })
  | (BaseMessage & {
      type: 'transcribe-audio';
      sessionId: string;
      chunkId: string;
      audioBase64: string;
    })
  | (BaseMessage & {
      type: 'transcribe-audio-binary';
      sessionId: string;
      chunkId: string;
      audioData: ArrayBuffer; // Transferred, not copied
    })
  | (BaseMessage & {
      type: 'update-summary';
      sessionId: string;
      contextJson: string;
    })
  | (BaseMessage & {
      type: 'chat';
      sessionId: string;
      requestId: string;
      message: string;
      contextJson: string;
    })
  | (BaseMessage & {
      type: 'check-analysis-mode';
      sessionId: string;
      contextJson: string;
      metricsJson: string;
    })
  | (BaseMessage & {
      type: 'set-analysis-mode';
      sessionId: string;
      mode: 'ambient' | 'deep';
    })
  | (BaseMessage & { type: 'stop' });

// ============================================================================
// Worker → Main Thread Messages
// ============================================================================

/** Base fields for all responses */
interface BaseResponse {
  /** ID of the original request (for correlation) */
  id?: string;
  /** Timestamp when response was created */
  timestamp: number;
}

export type WorkerResponse =
  | (BaseResponse & { type: 'ready' })
  | (BaseResponse & {
      type: 'state-change';
      from: WorkerState;
      to: WorkerState;
      reason?: string;
    })
  | (BaseResponse & {
      type: 'progress';
      sessionId: string;
      operation: string;
      progress: number; // 0-100
      message?: string;
    })
  | (BaseResponse & {
      type: 'analysis-complete';
      sessionId: string;
      screenshotId: string;
      analysis: ActivityDetection | null;
      error?: string;
    })
  | (BaseResponse & {
      type: 'transcription-complete';
      sessionId: string;
      chunkId: string;
      text: string;
    })
  | (BaseResponse & {
      type: 'transcription-start';
      sessionId: string;
    })
  | (BaseResponse & {
      type: 'summary-updated';
      sessionId: string;
      summary: string;
      keyMoments: string[];
      currentFocus: string;
    })
  | (BaseResponse & {
      type: 'capture-timing';
      sessionId: string;
      recommendedWaitMs: number;
      activityLevel: string;
      reason: string;
    })
  | (BaseResponse & {
      type: 'chat-response';
      requestId: string;
      response: string;
    })
  | (BaseResponse & {
      type: 'mode-changed';
      sessionId: string;
      mode: 'ambient' | 'deep';
      reason: string;
    })
  | (BaseResponse & {
      type: 'insight-created';
      sessionId: string;
      insightType: string;
      content: string;
    })
  | (BaseResponse & {
      type: 'request-summary-update';
      sessionId: string;
    })
  | (BaseResponse & {
      type: 'error';
      sessionId: string;
      error: string;
      requestId?: string;
    })
  | (BaseResponse & {
      type: 'log';
      level: 'info' | 'warn' | 'error';
      message: string;
    });

// ============================================================================
// Shared Types
// ============================================================================

/**
 * Context passed to worker for analysis operations
 * Mirrors SessionContext but is JSON-serializable
 */
export interface WorkerSessionContext {
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

/**
 * Activity metrics for analysis mode decisions
 */
export interface WorkerActivityMetrics {
  appSwitchCount: number;
  uniqueAppsCount: number;
  screenshotCount: number;
  audioWordCount: number;
  averageScreenshotChangeMagnitude: number;
  timeSinceLastActivity: number;
  currentFocusDuration: number;
}

// Re-export bot types for convenience
export type { ActivityDetection, RollingSummary, CaptureTimingDecision };
