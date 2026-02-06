/**
 * Request Manager
 *
 * Manages request/response correlation for worker communication.
 * Provides:
 * - Unique correlation IDs for all requests
 * - Configurable timeouts with automatic cleanup
 * - Abort support via AbortController
 * - Event emission for observability
 */

import { EventEmitter } from '../event-emitter';

// ============================================================================
// Types
// ============================================================================

export interface RequestOptions {
  /** Timeout in milliseconds (default: 60000) */
  timeout?: number;
  /** Optional AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Optional metadata to attach to request */
  metadata?: Record<string, unknown>;
}

export interface PendingRequest<T = unknown> {
  id: string;
  createdAt: number;
  timeout: number;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
  abortController: AbortController | null;
  metadata?: Record<string, unknown>;
}

export type RequestManagerEvents = {
  'request-created': { id: string; timeout: number; metadata?: Record<string, unknown> };
  'request-completed': { id: string; duration: number };
  'request-failed': { id: string; error: string; duration: number };
  'request-timeout': { id: string; timeout: number };
  'request-aborted': { id: string };
};

// ============================================================================
// Request Manager
// ============================================================================

export class RequestManager {
  private requests = new Map<string, PendingRequest>();
  private emitter = new EventEmitter<RequestManagerEvents>();
  private counter = 0;
  private prefix: string;
  private defaultTimeout: number;

  constructor(options: { prefix?: string; defaultTimeout?: number } = {}) {
    this.prefix = options.prefix ?? 'req';
    this.defaultTimeout = options.defaultTimeout ?? 60000;
  }

  /**
   * Generate a unique request ID
   */
  generateId(): string {
    return `${this.prefix}-${++this.counter}-${Date.now()}`;
  }

  /**
   * Create a new tracked request
   * Returns a promise that resolves when the request completes
   */
  create<T>(options: RequestOptions = {}): { id: string; promise: Promise<T> } {
    const id = this.generateId();
    const timeout = options.timeout ?? this.defaultTimeout;
    const createdAt = Date.now();

    let resolveRequest: (value: T) => void;
    let rejectRequest: (error: Error) => void;

    const promise = new Promise<T>((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });

    // Set up abort handling
    let abortController: AbortController | null = null;
    if (options.signal) {
      abortController = new AbortController();
      options.signal.addEventListener('abort', () => {
        this.abort(id);
      });
    }

    // Set up timeout
    const timeoutId = setTimeout(() => {
      this.timeout(id);
    }, timeout);

    const request: PendingRequest<T> = {
      id,
      createdAt,
      timeout,
      resolve: resolveRequest!,
      reject: rejectRequest!,
      timeoutId,
      abortController,
      metadata: options.metadata,
    };

    this.requests.set(id, request as PendingRequest);

    this.emitter.emit('request-created', { id, timeout, metadata: options.metadata });

    return { id, promise };
  }

  /**
   * Complete a request with a successful result
   */
  complete<T>(id: string, result: T): boolean {
    const request = this.requests.get(id);
    if (!request) return false;

    this.cleanup(id);
    const duration = Date.now() - request.createdAt;
    request.resolve(result);

    this.emitter.emit('request-completed', { id, duration });
    return true;
  }

  /**
   * Fail a request with an error
   */
  fail(id: string, error: Error | string): boolean {
    const request = this.requests.get(id);
    if (!request) return false;

    this.cleanup(id);
    const duration = Date.now() - request.createdAt;
    const err = typeof error === 'string' ? new Error(error) : error;
    request.reject(err);

    this.emitter.emit('request-failed', { id, error: err.message, duration });
    return true;
  }

  /**
   * Handle request timeout
   */
  private timeout(id: string): void {
    const request = this.requests.get(id);
    if (!request) return;

    this.cleanup(id);
    request.reject(new Error(`Request ${id} timed out after ${request.timeout}ms`));

    this.emitter.emit('request-timeout', { id, timeout: request.timeout });
  }

  /**
   * Abort a request
   */
  abort(id: string, silent: boolean = false): boolean {
    const request = this.requests.get(id);
    if (!request) return false;

    this.cleanup(id);
    request.abortController?.abort();

    if (!silent) {
      request.reject(new Error(`Request ${id} was aborted`));
      this.emitter.emit('request-aborted', { id });
    }

    return true;
  }

  /**
   * Check if a request exists
   */
  has(id: string): boolean {
    return this.requests.has(id);
  }

  /**
   * Get count of pending requests
   */
  get pendingCount(): number {
    return this.requests.size;
  }

  /**
   * Abort all pending requests
   * @param silent If true, don't reject the promises (for cleanup)
   */
  abortAll(silent: boolean = false): void {
    for (const id of this.requests.keys()) {
      this.abort(id, silent);
    }
  }

  /**
   * Clean up a request (remove from map, clear timeout)
   */
  private cleanup(id: string): void {
    const request = this.requests.get(id);
    if (request?.timeoutId) {
      clearTimeout(request.timeoutId);
    }
    this.requests.delete(id);
  }

  /**
   * Subscribe to request events
   */
  on<K extends keyof RequestManagerEvents>(
    event: K,
    callback: (data: RequestManagerEvents[K]) => void
  ): () => void {
    return this.emitter.on(event, callback);
  }

  /**
   * Clean up all resources
   * Silently aborts pending requests to avoid unhandled rejections during cleanup
   */
  destroy(): void {
    this.abortAll(true);
    this.emitter.removeAllListeners();
  }
}
