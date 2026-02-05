/**
 * AI Worker Client
 *
 * Main thread interface to the AI Worker.
 * All calls are non-blocking - results come back via events.
 *
 * v2 Changes:
 * - Uses RequestManager for correlation IDs (fixes C4)
 * - Clears worker reference on error (fixes C1)
 * - Tracks ready state via state machine events
 * - Proper cleanup in terminate()
 *
 * v3 Changes:
 * - Removed Tauri detection - workers use native fetch with CORS headers
 *   (Web Workers don't have access to window.__TAURI__)
 */

import type {
  WorkerMessage,
  WorkerResponse,
  WorkerSessionContext,
  WorkerActivityMetrics,
} from './types';
import type { WorkerState } from './worker-state';
import { EventEmitter } from '../event-emitter';
import { RequestManager } from './request-manager';
import { getSecureItem } from '../secure-storage';

// ============================================================================
// Event Types
// ============================================================================

export type AiWorkerEvents = {
  'analysis-complete': {
    sessionId: string;
    screenshotId: string;
    analysis: import('../bots/types').ActivityDetection | null;
    error?: string;
  };
  'transcription-start': { sessionId: string };
  'transcription-complete': { sessionId: string; chunkId: string; text: string };
  'summary-updated': {
    sessionId: string;
    summary: string;
    keyMoments: string[];
    currentFocus: string;
  };
  'capture-timing': {
    sessionId: string;
    recommendedWaitMs: number;
    activityLevel: string;
    reason: string;
  };
  'mode-changed': { sessionId: string; mode: 'ambient' | 'deep'; reason: string };
  'insight-created': { sessionId: string; insightType: string; content: string };
  'request-summary-update': { sessionId: string };
  'state-change': { from: WorkerState; to: WorkerState; reason?: string };
  'error': { sessionId: string; error: string };
};

// ============================================================================
// Client Implementation
// ============================================================================

class AiWorkerClient {
  private worker: Worker | null = null;
  private emitter = new EventEmitter<AiWorkerEvents>();
  private requestManager = new RequestManager({ prefix: 'worker', defaultTimeout: 60000 });
  private chatCallbacks = new Map<string, (response: string) => void>();
  private chatTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private initPromise: Promise<void> | null = null;
  private workerState: WorkerState = 'CREATED';
  private initAttempts = 0;
  private static readonly MAX_INIT_ATTEMPTS = 3;

  /**
   * Initialize the worker (lazy, called on first use)
   */
  async initialize(): Promise<void> {
    if (this.worker && this.isReady()) return;
    if (this.initPromise) return this.initPromise;

    // If in ERROR state, allow re-creation
    if (this.workerState === 'ERROR') {
      this.worker = null;
      this.workerState = 'CREATED';
    }

    if (this.initAttempts >= AiWorkerClient.MAX_INIT_ATTEMPTS) {
      throw new Error(`Worker failed to initialize after ${AiWorkerClient.MAX_INIT_ATTEMPTS} attempts. Please restart the app.`);
    }
    this.initAttempts++;

    this.initPromise = this.createWorker();
    return this.initPromise;
  }

  private async createWorker(): Promise<void> {
    try {
      // Create worker (Vite handles bundling with ?worker query)
      this.worker = new Worker(new URL('./ai-worker.ts', import.meta.url), { type: 'module' });

      // Handle messages from worker
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        this.handleMessage(event.data);
      };

      // Handle worker errors (fixes C1 - clear worker ref on crash)
      this.worker.onerror = (error) => {
        console.error('[AI Worker] Error:', error);
        this.handleWorkerError(error.message || 'Unknown worker error');
      };

      // Wait for ready signal with timeout
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Worker bootstrap timeout'));
        }, 10000);

        const handler = (event: MessageEvent<WorkerResponse>) => {
          if (event.data.type === 'ready') {
            clearTimeout(timeout);
            this.worker!.removeEventListener('message', handler);
            resolve();
          }
        };
        this.worker!.addEventListener('message', handler);
      });

      console.log('[AI Worker Client] Worker bootstrapped, sending API keys...');

      // Send API keys to worker
      const anthropicKey = await getSecureItem('sessions_api_key');
      const openaiKey = await getSecureItem('sessions_openai_api_key');

      console.log('[AI Worker Client] API keys:', anthropicKey ? 'configured' : 'not set', '/', openaiKey ? 'configured' : 'not set');

      // Warn if keys are missing - transcription/analysis will fail
      if (!anthropicKey) {
        console.warn('[AI Worker Client] No Anthropic API key - screenshot analysis will be disabled');
      }
      if (!openaiKey) {
        console.warn('[AI Worker Client] No OpenAI API key - audio transcription will be disabled');
      }

      // Wait for worker to process init and become INITIALIZED
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          // Timeout fired - assume worker is initialized (init is synchronous in worker)
          // Set state to prevent re-initialization attempts
          console.warn('[AI Worker Client] Init confirmation timeout, assuming initialized');
          this.worker!.removeEventListener('message', handler);
          this.workerState = 'INITIALIZED';
          resolve();
        }, 5000);

        const handler = (event: MessageEvent<WorkerResponse>) => {
          if (event.data.type === 'state-change' && event.data.to === 'INITIALIZED') {
            console.log('[AI Worker Client] Received INITIALIZED state confirmation');
            clearTimeout(timeout);
            this.worker!.removeEventListener('message', handler);
            this.workerState = 'INITIALIZED';
            resolve();
          }
        };
        this.worker!.addEventListener('message', handler);

        // Send init message
        this.send({
          type: 'init',
          id: this.requestManager.generateId(),
          timestamp: Date.now(),
          anthropicKey: anthropicKey || '',
          openaiKey: openaiKey || null,
        });
      });

      console.log('[AI Worker Client] Worker fully initialized');
      this.initAttempts = 0; // Reset on success
    } catch (error) {
      console.error('[AI Worker Client] Failed to initialize:', error);
      this.handleWorkerError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      this.initPromise = null;
    }
  }

  /**
   * Handle worker error - clears worker ref to allow recovery (fixes C1)
   */
  private handleWorkerError(message: string): void {
    this.workerState = 'ERROR';
    this.emitter.emit('error', { sessionId: '', error: message });

    // Clear worker reference to allow re-creation on next use
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        // Ignore termination errors
      }
      this.worker = null;
    }

    // Abort all pending requests
    this.requestManager.abortAll();

    // Clear chat callbacks
    this.chatTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.chatTimeouts.clear();
    this.chatCallbacks.forEach((callback) => callback('Worker error: ' + message));
    this.chatCallbacks.clear();
  }

  private send(message: WorkerMessage): void {
    if (!this.worker) {
      console.warn('[AI Worker Client] Worker not initialized, message dropped:', message.type);
      return;
    }
    this.worker.postMessage(message);
  }

  private handleMessage(msg: WorkerResponse): void {
    switch (msg.type) {
      case 'ready':
        this.workerState = 'READY';
        break;

      case 'state-change':
        this.workerState = msg.to;
        this.emitter.emit('state-change', {
          from: msg.from,
          to: msg.to,
          reason: msg.reason,
        });
        break;

      case 'analysis-complete':
        // Complete the correlated request if exists
        if (msg.id) {
          this.requestManager.complete(msg.id, msg);
        }
        this.emitter.emit('analysis-complete', {
          sessionId: msg.sessionId,
          screenshotId: msg.screenshotId,
          analysis: msg.analysis,
          error: msg.error,
        });
        break;

      case 'transcription-start':
        this.emitter.emit('transcription-start', { sessionId: msg.sessionId });
        break;

      case 'transcription-complete':
        if (msg.id) {
          this.requestManager.complete(msg.id, msg);
        }
        this.emitter.emit('transcription-complete', {
          sessionId: msg.sessionId,
          chunkId: msg.chunkId,
          text: msg.text,
        });
        break;

      case 'summary-updated':
        if (msg.id) {
          this.requestManager.complete(msg.id, msg);
        }
        this.emitter.emit('summary-updated', {
          sessionId: msg.sessionId,
          summary: msg.summary,
          keyMoments: msg.keyMoments,
          currentFocus: msg.currentFocus,
        });
        break;

      case 'capture-timing':
        this.emitter.emit('capture-timing', {
          sessionId: msg.sessionId,
          recommendedWaitMs: msg.recommendedWaitMs,
          activityLevel: msg.activityLevel,
          reason: msg.reason,
        });
        break;

      case 'mode-changed':
        this.emitter.emit('mode-changed', {
          sessionId: msg.sessionId,
          mode: msg.mode,
          reason: msg.reason,
        });
        break;

      case 'insight-created':
        this.emitter.emit('insight-created', {
          sessionId: msg.sessionId,
          insightType: msg.insightType,
          content: msg.content,
        });
        break;

      case 'request-summary-update':
        this.emitter.emit('request-summary-update', { sessionId: msg.sessionId });
        break;

      case 'chat-response': {
        const callback = this.chatCallbacks.get(msg.requestId);
        if (callback) {
          const timeout = this.chatTimeouts.get(msg.requestId);
          if (timeout) {
            clearTimeout(timeout);
            this.chatTimeouts.delete(msg.requestId);
          }
          this.chatCallbacks.delete(msg.requestId);
          callback(msg.response);
        }
        break;
      }

      case 'error':
        // Fail the correlated request if exists
        if (msg.requestId) {
          this.requestManager.fail(msg.requestId, msg.error);
        }
        this.emitter.emit('error', { sessionId: msg.sessionId, error: msg.error });
        break;

      case 'log':
        console[msg.level](`[AI Worker] ${msg.message}`);
        break;

      case 'progress':
        // Progress events can be handled by subscribers if needed
        break;
    }
  }

  // ============================================================================
  // Public API - Event Subscription
  // ============================================================================

  /**
   * Subscribe to worker events
   * Returns unsubscribe function
   */
  on<K extends keyof AiWorkerEvents>(
    event: K,
    callback: (data: AiWorkerEvents[K]) => void
  ): () => void {
    return this.emitter.on(event, callback);
  }

  // ============================================================================
  // Public API - Screenshot Analysis
  // ============================================================================

  /**
   * Analyze screenshot (non-blocking)
   * Results come back via 'analysis-complete' event
   */
  async analyzeScreenshot(
    sessionId: string,
    screenshotId: string,
    imageBase64: string,
    trigger: string,
    previousAnalysis: string | null = null
  ): Promise<void> {
    await this.initialize();
    const id = this.requestManager.generateId();
    this.send({
      type: 'analyze-screenshot',
      id,
      timestamp: Date.now(),
      sessionId,
      screenshotId,
      imageBase64,
      trigger,
      previousAnalysis,
    });
  }

  /**
   * Analyze screenshot with binary transfer (non-blocking, zero-copy)
   * Use this when you have ArrayBuffer from file load
   * Results come back via 'analysis-complete' event
   */
  async analyzeScreenshotBinary(
    sessionId: string,
    screenshotId: string,
    imageData: ArrayBuffer,
    trigger: string,
    previousAnalysis: string | null = null
  ): Promise<void> {
    await this.initialize();
    if (!this.worker) return;

    const id = this.requestManager.generateId();
    const message = {
      type: 'analyze-screenshot-binary' as const,
      id,
      timestamp: Date.now(),
      sessionId,
      screenshotId,
      imageData,
      trigger,
      previousAnalysis,
    };

    // Use postMessage with Transferable for zero-copy transfer
    this.worker.postMessage(message, [imageData]);
  }

  // ============================================================================
  // Public API - Audio Transcription
  // ============================================================================

  /**
   * Transcribe audio (non-blocking)
   * Results come back via 'transcription-complete' event
   */
  async transcribeAudio(sessionId: string, chunkId: string, audioBase64: string): Promise<void> {
    await this.initialize();
    const id = this.requestManager.generateId();
    this.send({
      type: 'transcribe-audio',
      id,
      timestamp: Date.now(),
      sessionId,
      chunkId,
      audioBase64,
    });
  }

  /**
   * Transcribe audio with binary transfer (non-blocking, zero-copy)
   * Use this when you have ArrayBuffer from file load
   * Results come back via 'transcription-complete' event
   */
  async transcribeAudioBinary(sessionId: string, chunkId: string, audioData: ArrayBuffer): Promise<void> {
    await this.initialize();
    if (!this.worker) return;

    const id = this.requestManager.generateId();
    const message = {
      type: 'transcribe-audio-binary' as const,
      id,
      timestamp: Date.now(),
      sessionId,
      chunkId,
      audioData,
    };

    // Use postMessage with Transferable for zero-copy transfer
    this.worker.postMessage(message, [audioData]);
  }

  // ============================================================================
  // Public API - Summary Updates
  // ============================================================================

  /**
   * Update rolling summary (non-blocking)
   * Results come back via 'summary-updated' event
   */
  async updateSummary(sessionId: string, context: WorkerSessionContext): Promise<void> {
    await this.initialize();
    const id = this.requestManager.generateId();
    this.send({
      type: 'update-summary',
      id,
      timestamp: Date.now(),
      sessionId,
      contextJson: JSON.stringify(context),
    });
  }

  // ============================================================================
  // Public API - Analysis Mode
  // ============================================================================

  /**
   * Check if analysis mode should change (non-blocking)
   * Results come back via 'mode-changed' event if change recommended
   */
  async checkAnalysisMode(
    sessionId: string,
    context: WorkerSessionContext,
    metrics: WorkerActivityMetrics
  ): Promise<void> {
    await this.initialize();
    const id = this.requestManager.generateId();
    this.send({
      type: 'check-analysis-mode',
      id,
      timestamp: Date.now(),
      sessionId,
      contextJson: JSON.stringify(context),
      metricsJson: JSON.stringify(metrics),
    });
  }

  /**
   * Manually set analysis mode
   */
  async setAnalysisMode(sessionId: string, mode: 'ambient' | 'deep'): Promise<void> {
    await this.initialize();
    const id = this.requestManager.generateId();
    this.send({
      type: 'set-analysis-mode',
      id,
      timestamp: Date.now(),
      sessionId,
      mode,
    });
  }

  // ============================================================================
  // Public API - Chat
  // ============================================================================

  /**
   * Send chat message and wait for response
   * This is the only blocking call - returns a Promise that resolves with the response
   */
  async chat(sessionId: string, message: string, context: WorkerSessionContext): Promise<string> {
    await this.initialize();

    const requestId = this.requestManager.generateId();

    return new Promise((resolve) => {
      this.chatCallbacks.set(requestId, resolve);

      this.send({
        type: 'chat',
        id: this.requestManager.generateId(),
        timestamp: Date.now(),
        sessionId,
        requestId,
        message,
        contextJson: JSON.stringify(context),
      });

      // Timeout after 60s
      const timeout = setTimeout(() => {
        if (this.chatCallbacks.has(requestId)) {
          this.chatCallbacks.delete(requestId);
          this.chatTimeouts.delete(requestId);
          resolve('Request timed out. Please try again.');
        }
      }, 60000);
      this.chatTimeouts.set(requestId, timeout);
    });
  }

  // ============================================================================
  // Public API - Lifecycle
  // ============================================================================

  /**
   * Get current worker state
   */
  getState(): WorkerState {
    return this.workerState;
  }

  /**
   * Check if worker is ready to accept work
   */
  isReady(): boolean {
    return (
      this.worker !== null &&
      (this.workerState === 'INITIALIZED' || this.workerState === 'PROCESSING')
    );
  }

  /**
   * Check if worker is initialized (alias for backward compatibility)
   */
  isInitialized(): boolean {
    return this.isReady();
  }

  /**
   * Get count of pending requests
   */
  getPendingRequestCount(): number {
    return this.requestManager.pendingCount;
  }

  /**
   * Reinitialize with new API keys (call after settings change)
   */
  async reinitialize(): Promise<void> {
    this.terminate();
    await this.initialize();
  }

  /**
   * Terminate the worker
   */
  terminate(): void {
    if (this.worker) {
      // Send stop message first
      this.send({
        type: 'stop',
        id: this.requestManager.generateId(),
        timestamp: Date.now(),
      });
      this.worker.terminate();
      this.worker = null;
    }

    this.workerState = 'TERMINATED';
    this.initPromise = null;

    // Clean up request manager
    this.requestManager.destroy();
    this.requestManager = new RequestManager({ prefix: 'worker', defaultTimeout: 60000 });

    // Clear all pending chat callbacks and timeouts
    this.chatTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.chatTimeouts.clear();
    this.chatCallbacks.clear();
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const aiWorker = new AiWorkerClient();
