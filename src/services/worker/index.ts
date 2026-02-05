/**
 * AI Worker Module
 *
 * Exports the worker client, types, and core abstractions for use by the rest of the application.
 *
 * Usage:
 *   import { aiWorker } from './worker';
 *
 *   // Non-blocking screenshot analysis
 *   aiWorker.analyzeScreenshot(sessionId, screenshotId, imageBase64, trigger);
 *
 *   // Subscribe to results
 *   aiWorker.on('analysis-complete', (data) => {
 *     console.log('Analysis:', data.analysis);
 *   });
 *
 *   // Subscribe to state changes
 *   aiWorker.on('state-change', (data) => {
 *     console.log('Worker state:', data.from, '->', data.to);
 *   });
 */

// Client
export { aiWorker, type AiWorkerEvents } from './ai-worker-client';

// Types
export type {
  WorkerMessage,
  WorkerResponse,
  WorkerSessionContext,
  WorkerActivityMetrics,
  ActivityDetection,
  RollingSummary,
  CaptureTimingDecision,
} from './types';

// Core abstractions (for testing and advanced use)
export { RequestManager, type RequestManagerEvents, type PendingRequest } from './request-manager';
export { WorkerStateMachine, type WorkerState, type StateTransition } from './worker-state';
export { MessageQueue, type MessageQueueStats } from './message-queue';
