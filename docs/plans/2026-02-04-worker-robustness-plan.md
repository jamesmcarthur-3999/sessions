# AI Worker Robustness Plan

## Executive Summary

The current Web Worker implementation has critical issues that make it fragile and untestable. This plan addresses **every issue** identified and establishes a foundation for reliable, testable, expandable code.

---

## Issues to Fix

### Critical Bugs

| ID | Issue | Location | Impact |
|----|-------|----------|--------|
| C1 | Worker crash creates duplicate workers | `ai-worker-client.ts:86-89` | Memory leak, undefined behavior |
| C2 | Race condition in async message handler | `ai-worker.ts:609+` | Operations run before init completes |
| C3 | Bootstrap failure leaves zombie worker | `ai-worker.ts:128-132` | Client times out, worker stays alive |
| C4 | No request/response correlation | Throughout | Can't track or cancel operations |

### Design Flaws

| ID | Issue | Location | Impact |
|----|-------|----------|--------|
| D1 | `stopSession` doesn't handle in-flight ops | `session-bridge.ts:104-122` | Work wasted, results dropped |
| D2 | Pause doesn't affect result handlers | `session-bridge.ts:184+` | Paused sessions still process |
| D3 | Worker not initialized proactively | `session-bridge.ts:84-99` | First operation delayed |
| D4 | No proper state machine | Worker | Hard to reason about state |
| D5 | Silent failures in worker init | `ai-worker.ts:139-141` | Client unaware of failures |

### Missing Infrastructure

| ID | Issue | Impact |
|----|-------|--------|
| I1 | No test framework | Can't verify behavior |
| I2 | No unit tests | Bugs ship undetected |
| I3 | No integration tests | System-level failures |
| I4 | No mocking utilities | Tests require real APIs |

---

## Architecture

### 1. Worker State Machine

```
┌─────────────┐
│   CREATED   │ Worker file loaded
└──────┬──────┘
       │ bootstrap() starts
       ▼
┌─────────────┐
│ BOOTSTRAPPING│ Loading baleybots modules
└──────┬──────┘
       │ success: send 'ready'
       │ failure: send 'bootstrap-failed', terminate
       ▼
┌─────────────┐
│    READY    │ Waiting for 'init' message
└──────┬──────┘
       │ 'init' received with API keys
       ▼
┌─────────────┐
│ INITIALIZED │ Ready to process requests
└──────┬──────┘
       │ Any operation
       ▼
┌─────────────┐
│ PROCESSING  │ Handling request (queued)
└──────┬──────┘
       │ Complete/Error
       ▼
┌─────────────┐
│ INITIALIZED │ Back to ready state
└─────────────┘

Error from any state → ERROR state → terminate
```

### 2. Message Queue Architecture

```typescript
// Request message with correlation ID
interface WorkerRequest {
  id: string;           // UUID for correlation
  type: string;         // Operation type
  payload: unknown;     // Operation-specific data
  timestamp: number;    // For timeout tracking
}

// Response message with correlation ID
interface WorkerResponse {
  id: string;           // Matches request ID
  type: 'success' | 'error' | 'progress';
  payload: unknown;
  timestamp: number;
}

// Client tracking
interface PendingRequest {
  id: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  abortController?: AbortController;
}
```

### 3. Request Lifecycle

```
Client                          Worker
  │                               │
  ├─── request {id, type} ───────►│
  │                               ├── Queue request
  │                               ├── Process when ready
  │◄── progress {id, data} ──────┤
  │◄── progress {id, data} ──────┤
  │◄── success {id, result} ─────┤
  │                               │
  ├── Track pending[id]           │
  ├── Clear on response           │
  └── Timeout after 60s           │
```

---

## Implementation Plan

### Phase 1: Test Infrastructure (Day 1)

**Goal:** Establish testing foundation before any code changes.

#### 1.1 Install Vitest

```bash
npm install -D vitest @vitest/coverage-v8 jsdom
```

#### 1.2 Configure Vitest

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/services/**/*.ts'],
    },
  },
});
```

#### 1.3 Create Test Utilities

Create `src/test/setup.ts`:
```typescript
import { afterEach, vi } from 'vitest';

// Clean up after each test
afterEach(() => {
  vi.clearAllMocks();
});

// Mock Worker API for Node environment
class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;

  postMessage(data: unknown) {
    // Implemented by tests
  }

  terminate() {
    // No-op
  }

  addEventListener(type: string, handler: EventListener) {
    if (type === 'message') {
      this.onmessage = handler as (e: MessageEvent) => void;
    }
  }

  removeEventListener() {}
}

vi.stubGlobal('Worker', MockWorker);
```

Create `src/test/mocks/baleybots.ts`:
```typescript
import { vi } from 'vitest';

export const mockPipeline = {
  process: vi.fn(),
  getId: () => 'mock-pipeline',
  getBotNames: () => ['mock-bot'],
  subscribeToAll: vi.fn(() => ({ unsubscribe: vi.fn() })),
};

export const mockBaleybots = {
  Baleybot: {
    setGlobalConfig: vi.fn(),
  },
  setDefaultApiKey: vi.fn(),
  pipeline: vi.fn(() => mockPipeline),
};
```

#### 1.4 Add npm scripts

```json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage"
  }
}
```

---

### Phase 2: Core Abstractions (Day 1-2)

**Goal:** Create robust, testable building blocks.

#### 2.1 Request Manager

Create `src/services/worker/request-manager.ts`:
```typescript
/**
 * Manages pending requests with correlation, timeout, and cancellation.
 *
 * Features:
 * - Request/response correlation via unique IDs
 * - Configurable timeouts with cleanup
 * - Abort support for cancellation
 * - Event emission for monitoring
 */

import { EventEmitter } from '../event-emitter';

export interface PendingRequest<T = unknown> {
  id: string;
  type: string;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  createdAt: number;
  abortController?: AbortController;
}

export type RequestManagerEvents = {
  'request-created': { id: string; type: string };
  'request-completed': { id: string; type: string; durationMs: number };
  'request-failed': { id: string; type: string; error: string };
  'request-timeout': { id: string; type: string };
  'request-aborted': { id: string; type: string };
};

export class RequestManager {
  private pending = new Map<string, PendingRequest>();
  private emitter = new EventEmitter<RequestManagerEvents>();
  private counter = 0;

  constructor(private defaultTimeoutMs = 60000) {}

  /**
   * Create a tracked request that returns a promise
   */
  createRequest<T>(
    type: string,
    options: {
      timeoutMs?: number;
      abortSignal?: AbortSignal;
    } = {}
  ): { id: string; promise: Promise<T> } {
    const id = `${type}-${++this.counter}-${Date.now()}`;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;

    let resolve: (value: T) => void;
    let reject: (error: Error) => void;

    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    const timeout = setTimeout(() => {
      if (this.pending.has(id)) {
        this.pending.delete(id);
        this.emitter.emit('request-timeout', { id, type });
        reject!(new Error(`Request ${type} timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    const abortController = new AbortController();

    // Handle external abort signal
    if (options.abortSignal) {
      options.abortSignal.addEventListener('abort', () => {
        this.abort(id);
      });
    }

    const request: PendingRequest<T> = {
      id,
      type,
      resolve: resolve!,
      reject: reject!,
      timeout,
      createdAt: Date.now(),
      abortController,
    };

    this.pending.set(id, request as PendingRequest);
    this.emitter.emit('request-created', { id, type });

    return { id, promise };
  }

  /**
   * Resolve a pending request
   */
  resolve<T>(id: string, value: T): boolean {
    const request = this.pending.get(id) as PendingRequest<T> | undefined;
    if (!request) return false;

    clearTimeout(request.timeout);
    this.pending.delete(id);

    const durationMs = Date.now() - request.createdAt;
    this.emitter.emit('request-completed', { id, type: request.type, durationMs });

    request.resolve(value);
    return true;
  }

  /**
   * Reject a pending request
   */
  reject(id: string, error: Error): boolean {
    const request = this.pending.get(id);
    if (!request) return false;

    clearTimeout(request.timeout);
    this.pending.delete(id);

    this.emitter.emit('request-failed', { id, type: request.type, error: error.message });

    request.reject(error);
    return true;
  }

  /**
   * Abort a pending request
   */
  abort(id: string): boolean {
    const request = this.pending.get(id);
    if (!request) return false;

    clearTimeout(request.timeout);
    request.abortController?.abort();
    this.pending.delete(id);

    this.emitter.emit('request-aborted', { id, type: request.type });

    request.reject(new Error('Request aborted'));
    return true;
  }

  /**
   * Check if a request is pending
   */
  hasPending(id: string): boolean {
    return this.pending.has(id);
  }

  /**
   * Get count of pending requests
   */
  getPendingCount(): number {
    return this.pending.size;
  }

  /**
   * Get all pending request IDs for a type
   */
  getPendingByType(type: string): string[] {
    return Array.from(this.pending.values())
      .filter(r => r.type === type)
      .map(r => r.id);
  }

  /**
   * Abort all pending requests
   */
  abortAll(): void {
    for (const id of this.pending.keys()) {
      this.abort(id);
    }
  }

  /**
   * Subscribe to events
   */
  on<K extends keyof RequestManagerEvents>(
    event: K,
    callback: (data: RequestManagerEvents[K]) => void
  ): () => void {
    return this.emitter.on(event, callback);
  }
}
```

#### 2.2 Worker State Machine

Create `src/services/worker/worker-state.ts`:
```typescript
/**
 * State machine for worker lifecycle management.
 *
 * States:
 * - CREATED: Worker instantiated but not started
 * - BOOTSTRAPPING: Loading dependencies
 * - READY: Dependencies loaded, waiting for init
 * - INITIALIZING: Processing init message
 * - INITIALIZED: Ready to handle requests
 * - PROCESSING: Handling a request
 * - ERROR: Unrecoverable error
 * - TERMINATED: Worker stopped
 */

export type WorkerState =
  | 'CREATED'
  | 'BOOTSTRAPPING'
  | 'READY'
  | 'INITIALIZING'
  | 'INITIALIZED'
  | 'PROCESSING'
  | 'ERROR'
  | 'TERMINATED';

export type WorkerTransition =
  | { from: 'CREATED'; to: 'BOOTSTRAPPING'; reason: 'bootstrap_start' }
  | { from: 'BOOTSTRAPPING'; to: 'READY'; reason: 'bootstrap_success' }
  | { from: 'BOOTSTRAPPING'; to: 'ERROR'; reason: 'bootstrap_failed' }
  | { from: 'READY'; to: 'INITIALIZING'; reason: 'init_received' }
  | { from: 'INITIALIZING'; to: 'INITIALIZED'; reason: 'init_success' }
  | { from: 'INITIALIZING'; to: 'ERROR'; reason: 'init_failed' }
  | { from: 'INITIALIZED'; to: 'PROCESSING'; reason: 'request_received' }
  | { from: 'PROCESSING'; to: 'INITIALIZED'; reason: 'request_complete' }
  | { from: 'PROCESSING'; to: 'ERROR'; reason: 'request_failed' }
  | { from: WorkerState; to: 'TERMINATED'; reason: 'terminate' }
  | { from: WorkerState; to: 'ERROR'; reason: 'crash' };

const VALID_TRANSITIONS: Record<WorkerState, WorkerState[]> = {
  CREATED: ['BOOTSTRAPPING', 'TERMINATED', 'ERROR'],
  BOOTSTRAPPING: ['READY', 'ERROR', 'TERMINATED'],
  READY: ['INITIALIZING', 'ERROR', 'TERMINATED'],
  INITIALIZING: ['INITIALIZED', 'ERROR', 'TERMINATED'],
  INITIALIZED: ['PROCESSING', 'ERROR', 'TERMINATED'],
  PROCESSING: ['INITIALIZED', 'ERROR', 'TERMINATED'],
  ERROR: ['TERMINATED'],
  TERMINATED: [],
};

export class WorkerStateMachine {
  private state: WorkerState = 'CREATED';
  private listeners: Array<(from: WorkerState, to: WorkerState, reason: string) => void> = [];
  private errorMessage?: string;

  getState(): WorkerState {
    return this.state;
  }

  getError(): string | undefined {
    return this.errorMessage;
  }

  canTransition(to: WorkerState): boolean {
    return VALID_TRANSITIONS[this.state].includes(to);
  }

  transition(to: WorkerState, reason: string): boolean {
    if (!this.canTransition(to)) {
      console.error(`Invalid transition: ${this.state} → ${to} (reason: ${reason})`);
      return false;
    }

    const from = this.state;
    this.state = to;

    if (to === 'ERROR') {
      this.errorMessage = reason;
    }

    this.listeners.forEach(fn => fn(from, to, reason));
    return true;
  }

  onTransition(callback: (from: WorkerState, to: WorkerState, reason: string) => void): () => void {
    this.listeners.push(callback);
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  isReady(): boolean {
    return this.state === 'INITIALIZED' || this.state === 'PROCESSING';
  }

  isTerminal(): boolean {
    return this.state === 'ERROR' || this.state === 'TERMINATED';
  }
}
```

#### 2.3 Message Queue for Worker

Create `src/services/worker/message-queue.ts`:
```typescript
/**
 * Sequential message queue for worker.
 * Ensures messages are processed one at a time.
 */

export interface QueuedMessage<T = unknown> {
  id: string;
  data: T;
  timestamp: number;
}

export class MessageQueue<T = unknown> {
  private queue: QueuedMessage<T>[] = [];
  private processing = false;
  private processor: ((message: QueuedMessage<T>) => Promise<void>) | null = null;

  setProcessor(fn: (message: QueuedMessage<T>) => Promise<void>): void {
    this.processor = fn;
    this.processNext();
  }

  enqueue(id: string, data: T): void {
    this.queue.push({ id, data, timestamp: Date.now() });
    this.processNext();
  }

  private async processNext(): Promise<void> {
    if (this.processing || !this.processor || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    const message = this.queue.shift()!;

    try {
      await this.processor(message);
    } catch (error) {
      console.error('Message processing error:', error);
    } finally {
      this.processing = false;
      this.processNext();
    }
  }

  clear(): void {
    this.queue = [];
  }

  size(): number {
    return this.queue.length;
  }

  isProcessing(): boolean {
    return this.processing;
  }
}
```

---

### Phase 3: Worker Rewrite (Day 2-3)

**Goal:** Robust worker with proper state management and message handling.

#### 3.1 Worker Types Update

Update `src/services/worker/types.ts`:
```typescript
/**
 * Worker Message Protocol v2
 *
 * All messages include correlation ID for request/response matching.
 */

// ============================================================================
// Request Messages (Client → Worker)
// ============================================================================

interface BaseRequest {
  id: string;           // Correlation ID
  timestamp: number;    // When sent
}

export type WorkerRequest =
  | BaseRequest & { type: 'init'; anthropicKey: string; openaiKey: string | null }
  | BaseRequest & { type: 'analyze-screenshot'; sessionId: string; screenshotId: string; imageBase64: string; trigger: string; previousAnalysis: string | null }
  | BaseRequest & { type: 'transcribe-audio'; sessionId: string; chunkId: string; audioBase64: string }
  | BaseRequest & { type: 'update-summary'; sessionId: string; context: WorkerSessionContext }
  | BaseRequest & { type: 'chat'; sessionId: string; message: string; context: WorkerSessionContext }
  | BaseRequest & { type: 'check-analysis-mode'; sessionId: string; context: WorkerSessionContext; metrics: WorkerActivityMetrics }
  | BaseRequest & { type: 'set-analysis-mode'; sessionId: string; mode: 'ambient' | 'deep' }
  | BaseRequest & { type: 'abort'; targetId: string }
  | BaseRequest & { type: 'terminate' };

// ============================================================================
// Response Messages (Worker → Client)
// ============================================================================

interface BaseResponse {
  id: string;           // Correlation ID (matches request)
  timestamp: number;
}

export type WorkerResponse =
  // Lifecycle
  | { type: 'state-change'; state: WorkerState; reason: string }
  | { type: 'ready' }

  // Request responses
  | BaseResponse & { type: 'success'; result: unknown }
  | BaseResponse & { type: 'error'; error: string; code?: string }
  | BaseResponse & { type: 'progress'; event: ProgressEvent }

  // Async events (not tied to specific request)
  | { type: 'insight-created'; sessionId: string; insightType: string; content: string }
  | { type: 'request-summary-update'; sessionId: string }
  | { type: 'capture-timing'; sessionId: string; recommendedWaitMs: number; activityLevel: string; reason: string }
  | { type: 'mode-changed'; sessionId: string; mode: 'ambient' | 'deep'; reason: string }

  // Logging
  | { type: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string };

export type ProgressEvent =
  | { kind: 'transcription-start' }
  | { kind: 'analysis-start' }
  | { kind: 'streaming'; delta: string };

export type WorkerState =
  | 'BOOTSTRAPPING'
  | 'READY'
  | 'INITIALIZING'
  | 'INITIALIZED'
  | 'ERROR'
  | 'TERMINATED';

// ... (keep existing WorkerSessionContext, WorkerActivityMetrics, bot types)
```

#### 3.2 Worker Rewrite

Rewrite `src/services/worker/ai-worker.ts`:
```typescript
/**
 * AI Worker v2
 *
 * Improvements:
 * - Proper state machine
 * - Sequential message queue (no race conditions)
 * - Request/response correlation
 * - Graceful error handling and shutdown
 */

/// <reference lib="webworker" />

import type { WorkerRequest, WorkerResponse, WorkerState } from './types';
import { MessageQueue } from './message-queue';

// ============================================================================
// State
// ============================================================================

let state: WorkerState = 'BOOTSTRAPPING';
let baleybots: typeof import('@baleybots/core') | null = null;
let botsModule: typeof import('../bots') | null = null;
let anthropicKey: string | null = null;
let openaiKey: string | null = null;

const messageQueue = new MessageQueue<WorkerRequest>();
const activeRequests = new Map<string, AbortController>();

// ============================================================================
// Communication
// ============================================================================

function send(message: WorkerResponse): void {
  self.postMessage(message);
}

function log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
  send({ type: 'log', level, message });
}

function transitionState(newState: WorkerState, reason: string): void {
  const oldState = state;
  state = newState;
  log('info', `State: ${oldState} → ${newState} (${reason})`);
  send({ type: 'state-change', state: newState, reason });

  if (newState === 'ERROR') {
    // Clean up and prepare for termination
    messageQueue.clear();
    activeRequests.forEach(controller => controller.abort());
    activeRequests.clear();
  }
}

function respond(id: string, result: unknown): void {
  activeRequests.delete(id);
  send({ type: 'success', id, timestamp: Date.now(), result });
}

function respondError(id: string, error: string, code?: string): void {
  activeRequests.delete(id);
  send({ type: 'error', id, timestamp: Date.now(), error, code });
}

function respondProgress(id: string, event: import('./types').ProgressEvent): void {
  send({ type: 'progress', id, timestamp: Date.now(), event });
}

// ============================================================================
// Bootstrap
// ============================================================================

async function bootstrap(): Promise<void> {
  try {
    log('info', 'Bootstrapping...');

    baleybots = await import('@baleybots/core');
    baleybots.Baleybot.setGlobalConfig({
      anthropic: {
        headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
      },
    });

    botsModule = await import('../bots');

    transitionState('READY', 'bootstrap_success');
    send({ type: 'ready' });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log('error', `Bootstrap failed: ${msg}`);
    transitionState('ERROR', `bootstrap_failed: ${msg}`);
    // Terminate self after error
    self.close();
  }
}

// ============================================================================
// Request Handlers
// ============================================================================

async function handleInit(request: Extract<WorkerRequest, { type: 'init' }>): Promise<void> {
  if (state !== 'READY') {
    respondError(request.id, `Cannot init in state: ${state}`, 'INVALID_STATE');
    return;
  }

  transitionState('INITIALIZING', 'init_received');

  try {
    anthropicKey = request.anthropicKey || null;
    openaiKey = request.openaiKey || null;

    if (anthropicKey && baleybots) {
      baleybots.setDefaultApiKey('anthropic', anthropicKey);
      log('info', 'Anthropic API key set');
    }

    if (openaiKey && baleybots) {
      baleybots.setDefaultApiKey('openai', openaiKey);
      log('info', 'OpenAI API key set');
    }

    transitionState('INITIALIZED', 'init_success');
    respond(request.id, { initialized: true, hasAnthropicKey: !!anthropicKey, hasOpenaiKey: !!openaiKey });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    transitionState('ERROR', `init_failed: ${msg}`);
    respondError(request.id, msg, 'INIT_FAILED');
  }
}

async function handleAnalyzeScreenshot(
  request: Extract<WorkerRequest, { type: 'analyze-screenshot' }>
): Promise<void> {
  if (state !== 'INITIALIZED') {
    respondError(request.id, `Cannot process in state: ${state}`, 'INVALID_STATE');
    return;
  }

  if (!botsModule || !anthropicKey) {
    respondError(request.id, 'Not configured', 'NOT_CONFIGURED');
    return;
  }

  const abortController = new AbortController();
  activeRequests.set(request.id, abortController);

  try {
    respondProgress(request.id, { kind: 'analysis-start' });

    const input = botsModule.buildActivityDetectorInput(
      request.imageBase64,
      request.previousAnalysis || undefined
    );

    const result = await botsModule.createActivityDetectorPipeline().process(input);

    if (abortController.signal.aborted) {
      respondError(request.id, 'Aborted', 'ABORTED');
      return;
    }

    // Emit side effects
    if (result?.suggestedInsight) {
      send({
        type: 'insight-created',
        sessionId: request.sessionId,
        insightType: 'moment',
        content: result.suggestedInsight,
      });
    }

    if (result?.hasSignificantChange) {
      send({ type: 'request-summary-update', sessionId: request.sessionId });
    }

    respond(request.id, {
      screenshotId: request.screenshotId,
      analysis: result,
    });

    // Get capture timing recommendation
    if (result?.currentContext) {
      const timingInput = botsModule.buildCaptureTimingInput(result.currentContext, {
        appSwitchCount: 0,
        timeSinceLastCapture: 0,
        lastActivityType: result.activityType || 'unknown',
        analysisMode: 'ambient',
      });

      const timing = await botsModule.createCaptureTimingPipeline().process(timingInput);

      if (timing?.recommendedWaitSeconds) {
        send({
          type: 'capture-timing',
          sessionId: request.sessionId,
          recommendedWaitMs: Math.max(5000, Math.min(180000, timing.recommendedWaitSeconds * 1000)),
          activityLevel: timing.activityLevel || 'medium',
          reason: timing.reason || 'AI recommendation',
        });
      }
    }

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    respondError(request.id, msg, 'ANALYSIS_FAILED');
  }
}

async function handleTranscribeAudio(
  request: Extract<WorkerRequest, { type: 'transcribe-audio' }>
): Promise<void> {
  if (state !== 'INITIALIZED') {
    respondError(request.id, `Cannot process in state: ${state}`, 'INVALID_STATE');
    return;
  }

  if (!openaiKey) {
    respondError(request.id, 'OpenAI key not configured', 'NOT_CONFIGURED');
    return;
  }

  const abortController = new AbortController();
  activeRequests.set(request.id, abortController);

  try {
    respondProgress(request.id, { kind: 'transcription-start' });

    // Prepare audio data
    const base64Data = request.audioBase64.replace(/^data:audio\/\w+;base64,/, '');
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: 'audio/wav' });
    const formData = new FormData();
    formData.append('file', blob, 'audio.wav');
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'json');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: formData,
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`Whisper API error: ${response.status}`);
    }

    const result = await response.json();
    const text = result.text || '';

    respond(request.id, {
      chunkId: request.chunkId,
      text,
    });

    if (text.trim()) {
      send({ type: 'request-summary-update', sessionId: request.sessionId });
    }

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      respondError(request.id, 'Aborted', 'ABORTED');
    } else {
      const msg = error instanceof Error ? error.message : String(error);
      respondError(request.id, msg, 'TRANSCRIPTION_FAILED');
    }
  }
}

async function handleChat(
  request: Extract<WorkerRequest, { type: 'chat' }>
): Promise<void> {
  if (state !== 'INITIALIZED') {
    respondError(request.id, `Cannot process in state: ${state}`, 'INVALID_STATE');
    return;
  }

  if (!botsModule || !anthropicKey) {
    respond(request.id, { answer: 'Please configure your API key in Settings.' });
    return;
  }

  try {
    const input = botsModule.buildQAInput(request.message, request.context);
    const result = await botsModule.createQABotPipeline().process(input);

    respond(request.id, {
      answer: result?.answer || 'Unable to generate response.',
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    respond(request.id, { answer: `Error: ${msg}` });
  }
}

async function handleUpdateSummary(
  request: Extract<WorkerRequest, { type: 'update-summary' }>
): Promise<void> {
  if (state !== 'INITIALIZED' || !botsModule || !anthropicKey) {
    respond(request.id, { updated: false });
    return;
  }

  try {
    const input = botsModule.buildSummarizerInput(request.context);
    const result = await botsModule.createSummarizerPipeline().process(input);

    if (result?.summary) {
      respond(request.id, {
        updated: true,
        summary: result.summary,
        keyMoments: result.keyMoments || [],
        currentFocus: result.currentFocus || '',
      });
    } else {
      respond(request.id, { updated: false });
    }

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log('error', `Summary update failed: ${msg}`);
    respond(request.id, { updated: false, error: msg });
  }
}

async function handleCheckAnalysisMode(
  request: Extract<WorkerRequest, { type: 'check-analysis-mode' }>
): Promise<void> {
  if (state !== 'INITIALIZED' || !botsModule || !anthropicKey) {
    respond(request.id, { changed: false });
    return;
  }

  try {
    const input = botsModule.buildAnalysisControllerInput(request.context, request.metrics);
    const result = await botsModule.createAnalysisControllerPipeline().process(input);

    if (result && result.confidence > 0.7 && result.recommendedMode !== request.context.analysisMode) {
      send({
        type: 'mode-changed',
        sessionId: request.sessionId,
        mode: result.recommendedMode,
        reason: result.reason || 'Activity-based adjustment',
      });
      respond(request.id, { changed: true, newMode: result.recommendedMode });
    } else {
      respond(request.id, { changed: false });
    }

  } catch (error) {
    respond(request.id, { changed: false });
  }
}

async function handleSetAnalysisMode(
  request: Extract<WorkerRequest, { type: 'set-analysis-mode' }>
): Promise<void> {
  send({
    type: 'mode-changed',
    sessionId: request.sessionId,
    mode: request.mode,
    reason: 'Manual override',
  });
  respond(request.id, { set: true });
}

async function handleAbort(request: Extract<WorkerRequest, { type: 'abort' }>): Promise<void> {
  const controller = activeRequests.get(request.targetId);
  if (controller) {
    controller.abort();
    activeRequests.delete(request.targetId);
    respond(request.id, { aborted: true });
  } else {
    respond(request.id, { aborted: false, reason: 'Request not found' });
  }
}

// ============================================================================
// Message Handler
// ============================================================================

async function processMessage(queued: { id: string; data: WorkerRequest }): Promise<void> {
  const request = queued.data;

  switch (request.type) {
    case 'init':
      await handleInit(request);
      break;
    case 'analyze-screenshot':
      await handleAnalyzeScreenshot(request);
      break;
    case 'transcribe-audio':
      await handleTranscribeAudio(request);
      break;
    case 'chat':
      await handleChat(request);
      break;
    case 'update-summary':
      await handleUpdateSummary(request);
      break;
    case 'check-analysis-mode':
      await handleCheckAnalysisMode(request);
      break;
    case 'set-analysis-mode':
      await handleSetAnalysisMode(request);
      break;
    case 'abort':
      await handleAbort(request);
      break;
    case 'terminate':
      transitionState('TERMINATED', 'requested');
      respond(request.id, { terminated: true });
      self.close();
      break;
    default:
      log('warn', `Unknown message type: ${(request as WorkerRequest).type}`);
  }
}

// Set up queue processor
messageQueue.setProcessor(processMessage);

// Message handler - just queues messages
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  messageQueue.enqueue(event.data.id, event.data);
};

// Error handler
self.onerror = (event) => {
  log('error', `Worker error: ${event.message}`);
  transitionState('ERROR', `crash: ${event.message}`);
};

// Start bootstrap
bootstrap();

export {};
```

---

### Phase 4: Client Rewrite (Day 3-4)

**Goal:** Robust client with proper request tracking and error handling.

#### 4.1 Client Rewrite

Rewrite `src/services/worker/ai-worker-client.ts` to use `RequestManager` and properly handle all edge cases. (Full implementation in separate file due to length.)

Key changes:
- Use `RequestManager` for all operations
- Handle worker crashes by nullifying worker reference
- Wait for init confirmation before allowing operations
- Proper cleanup on terminate

---

### Phase 5: Session Bridge Fixes (Day 4)

**Goal:** Fix all session lifecycle issues.

#### 5.1 Track In-Flight Operations

```typescript
class SessionBridgeService {
  // ... existing fields ...
  private inflightOperations = new Map<string, Set<string>>(); // sessionId → requestIds

  async stopSession(sessionId: string): Promise<void> {
    // Wait for in-flight operations to complete (with timeout)
    const inflight = this.inflightOperations.get(sessionId);
    if (inflight && inflight.size > 0) {
      const timeout = 5000;
      const start = Date.now();

      while (inflight.size > 0 && Date.now() - start < timeout) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (inflight.size > 0) {
        console.warn(`[SESSION BRIDGE] ${inflight.size} operations still pending after timeout`);
      }
    }

    // ... rest of cleanup ...
  }
}
```

#### 5.2 Pause Affects All Handlers

Add pause check to all event handlers:
```typescript
const unsubAnalysis = aiWorker.on('analysis-complete', async (data) => {
  if (!this.activeSessions.has(data.sessionId)) return;
  if (this.pausedSessions.has(data.sessionId)) {
    // Still emit to UI but don't persist
    this.emitter.emit('activity-detected', { ... });
    return;
  }
  // ... persist and emit ...
});
```

#### 5.3 Proactive Worker Initialization

```typescript
async startSession(sessionId: string): Promise<void> {
  // ... existing code ...

  // Proactively initialize worker
  try {
    await aiWorker.initialize();
  } catch (error) {
    console.warn('[SESSION BRIDGE] Worker initialization failed:', error);
    // Continue anyway - operations will fail gracefully
  }
}
```

---

### Phase 6: Tests (Day 4-5)

**Goal:** Comprehensive test coverage.

#### 6.1 Unit Tests

Create tests for each component:

```
src/services/worker/__tests__/
├── request-manager.test.ts
├── worker-state.test.ts
├── message-queue.test.ts
├── ai-worker-client.test.ts
└── ai-worker.test.ts

src/services/__tests__/
├── session-bridge.test.ts
├── smart-capture.test.ts
└── event-emitter.test.ts
```

Example test file `src/services/worker/__tests__/request-manager.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RequestManager } from '../request-manager';

describe('RequestManager', () => {
  let manager: RequestManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new RequestManager(1000); // 1s timeout for tests
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createRequest', () => {
    it('creates a request with unique ID', () => {
      const { id: id1 } = manager.createRequest('test');
      const { id: id2 } = manager.createRequest('test');

      expect(id1).not.toBe(id2);
      expect(manager.getPendingCount()).toBe(2);
    });

    it('resolves when resolve is called', async () => {
      const { id, promise } = manager.createRequest<string>('test');

      manager.resolve(id, 'success');

      await expect(promise).resolves.toBe('success');
      expect(manager.getPendingCount()).toBe(0);
    });

    it('rejects when reject is called', async () => {
      const { id, promise } = manager.createRequest('test');

      manager.reject(id, new Error('failure'));

      await expect(promise).rejects.toThrow('failure');
    });

    it('times out after configured duration', async () => {
      const { promise } = manager.createRequest('test');

      vi.advanceTimersByTime(1001);

      await expect(promise).rejects.toThrow('timed out');
    });

    it('emits timeout event', async () => {
      const onTimeout = vi.fn();
      manager.on('request-timeout', onTimeout);

      manager.createRequest('test');
      vi.advanceTimersByTime(1001);

      expect(onTimeout).toHaveBeenCalled();
    });
  });

  describe('abort', () => {
    it('aborts a pending request', async () => {
      const { id, promise } = manager.createRequest('test');

      manager.abort(id);

      await expect(promise).rejects.toThrow('aborted');
    });

    it('returns false for unknown request', () => {
      expect(manager.abort('unknown')).toBe(false);
    });
  });

  describe('abortAll', () => {
    it('aborts all pending requests', async () => {
      const { promise: p1 } = manager.createRequest('test1');
      const { promise: p2 } = manager.createRequest('test2');

      manager.abortAll();

      await expect(p1).rejects.toThrow('aborted');
      await expect(p2).rejects.toThrow('aborted');
      expect(manager.getPendingCount()).toBe(0);
    });
  });
});
```

#### 6.2 Integration Tests

Create `src/services/__tests__/integration/worker-flow.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { aiWorker } from '../../worker';
import { sessionBridge } from '../../session-bridge';

// These tests use mocked Worker but test the full flow

describe('Worker Integration', () => {
  beforeEach(async () => {
    // Reset state between tests
    aiWorker.terminate();
  });

  describe('initialization flow', () => {
    it('initializes worker and sets API keys', async () => {
      // Mock secure storage
      vi.mock('../../secure-storage', () => ({
        getSecureItem: vi.fn()
          .mockResolvedValueOnce('test-anthropic-key')
          .mockResolvedValueOnce('test-openai-key'),
      }));

      await aiWorker.initialize();

      expect(aiWorker.isInitialized()).toBe(true);
    });
  });

  describe('session lifecycle', () => {
    it('starts and stops session cleanly', async () => {
      const sessionId = 'test-session';

      await sessionBridge.startSession(sessionId);
      expect(sessionBridge.isSessionPaused(sessionId)).toBe(false);

      await sessionBridge.stopSession(sessionId);
      // Verify cleanup happened
    });
  });
});
```

---

### Phase 7: Documentation & Cleanup (Day 5)

**Goal:** Clean up old code and document the new architecture.

#### 7.1 Remove Deprecated Code

- Delete `src/services/session-coordinator.ts` (deprecated)
- Remove any remaining imports

#### 7.2 Architecture Documentation

Create `docs/architecture/worker-system.md` documenting:
- State machine diagrams
- Message protocol
- Error handling
- Testing approach

---

## Verification Checklist

Before considering complete, verify:

- [ ] `npm run test` passes with 100% of new code covered
- [ ] `npm run test:run` completes without errors
- [ ] `npx tsc --noEmit` has no errors
- [ ] Worker initializes successfully in dev mode
- [ ] Session can start/stop without errors
- [ ] Screenshot analysis works end-to-end
- [ ] Audio transcription works end-to-end
- [ ] Chat works end-to-end
- [ ] Pause/resume works correctly
- [ ] Worker crash is handled gracefully
- [ ] All edge cases have tests

---

## Timeline

| Day | Phase | Deliverables |
|-----|-------|--------------|
| 1 | Test Infrastructure | Vitest configured, test utilities, mock Worker |
| 1-2 | Core Abstractions | RequestManager, WorkerStateMachine, MessageQueue with tests |
| 2-3 | Worker Rewrite | New ai-worker.ts with state machine and queue |
| 3-4 | Client Rewrite | New ai-worker-client.ts with RequestManager |
| 4 | Session Bridge | In-flight tracking, pause fixes, proactive init |
| 4-5 | Tests | Unit tests, integration tests, coverage |
| 5 | Documentation | Architecture docs, cleanup deprecated code |

---

## Success Criteria

1. **Zero race conditions** - Message queue ensures sequential processing
2. **Zero memory leaks** - Proper cleanup of timeouts, listeners, workers
3. **Graceful error handling** - All errors caught, logged, and surfaced appropriately
4. **100% testable** - Every component can be unit tested in isolation
5. **Observable** - State changes, request lifecycle all emit events
6. **Recoverable** - Worker crash detected and handled, can reinitialize
