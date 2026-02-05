/**
 * Worker Mock
 *
 * Mock implementation of Web Worker for testing the AI Worker system.
 */

import { vi } from 'vitest';
import type { WorkerMessage, WorkerResponse } from '../../services/worker/types';

type MessageHandler = (event: MessageEvent<WorkerResponse>) => void;
type ErrorHandler = (event: ErrorEvent) => void;

/**
 * Mock Worker class that simulates the AI Worker behavior
 */
export class MockWorker {
  onmessage: MessageHandler | null = null;
  onerror: ErrorHandler | null = null;
  url: URL | string;
  options?: WorkerOptions;

  private messageListeners = new Set<MessageHandler>();
  private errorListeners = new Set<ErrorHandler>();
  private isTerminated = false;
  private messageQueue: WorkerMessage[] = [];
  private autoReady: boolean;
  private messageDelay: number;

  constructor(
    url: URL | string,
    options?: WorkerOptions,
    config: { autoReady?: boolean; messageDelay?: number } = {}
  ) {
    this.url = url;
    this.options = options;
    this.autoReady = config.autoReady ?? true;
    this.messageDelay = config.messageDelay ?? 0;

    // Auto-send ready message after construction
    if (this.autoReady) {
      setTimeout(() => this.simulateReady(), 0);
    }
  }

  postMessage(message: WorkerMessage): void {
    if (this.isTerminated) {
      throw new Error('Worker is terminated');
    }
    this.messageQueue.push(message);
  }

  terminate(): void {
    this.isTerminated = true;
    this.messageListeners.clear();
    this.errorListeners.clear();
    this.onmessage = null;
    this.onerror = null;
  }

  addEventListener(type: 'message', listener: MessageHandler): void;
  addEventListener(type: 'error', listener: ErrorHandler): void;
  addEventListener(type: string, listener: any): void {
    if (type === 'message') {
      this.messageListeners.add(listener);
    } else if (type === 'error') {
      this.errorListeners.add(listener);
    }
  }

  removeEventListener(type: 'message', listener: MessageHandler): void;
  removeEventListener(type: 'error', listener: ErrorHandler): void;
  removeEventListener(type: string, listener: any): void {
    if (type === 'message') {
      this.messageListeners.delete(listener);
    } else if (type === 'error') {
      this.errorListeners.delete(listener);
    }
  }

  // ============================================================================
  // Test Helpers
  // ============================================================================

  /**
   * Simulate a message from the worker to the main thread
   */
  simulateMessage(data: WorkerResponse): void {
    if (this.isTerminated) return;

    const event = new MessageEvent('message', { data });

    if (this.onmessage) {
      if (this.messageDelay > 0) {
        setTimeout(() => this.onmessage?.(event), this.messageDelay);
      } else {
        this.onmessage(event);
      }
    }

    this.messageListeners.forEach((listener) => {
      if (this.messageDelay > 0) {
        setTimeout(() => listener(event), this.messageDelay);
      } else {
        listener(event);
      }
    });
  }

  /**
   * Simulate the ready message
   */
  simulateReady(): void {
    this.simulateMessage({ type: 'ready', timestamp: Date.now() });
  }

  /**
   * Simulate an error in the worker
   */
  simulateError(message: string): void {
    if (this.isTerminated) return;

    const event = new ErrorEvent('error', { message });

    if (this.onerror) {
      this.onerror(event);
    }

    this.errorListeners.forEach((listener) => {
      listener(event);
    });
  }

  /**
   * Simulate worker crash (terminates and fires error)
   */
  simulateCrash(message: string = 'Worker crashed'): void {
    this.simulateError(message);
    this.isTerminated = true;
  }

  /**
   * Get all messages sent to the worker
   */
  getMessages(): WorkerMessage[] {
    return [...this.messageQueue];
  }

  /**
   * Get the last message sent to the worker
   */
  getLastMessage(): WorkerMessage | undefined {
    return this.messageQueue[this.messageQueue.length - 1];
  }

  /**
   * Clear the message queue
   */
  clearMessages(): void {
    this.messageQueue = [];
  }

  /**
   * Check if worker is terminated
   */
  get terminated(): boolean {
    return this.isTerminated;
  }
}

/**
 * Create a mock Worker constructor that can be spied on
 */
export function createMockWorkerConstructor(
  config: { autoReady?: boolean; messageDelay?: number } = {}
) {
  const instances: MockWorker[] = [];

  const MockWorkerConstructor = vi.fn((url: URL | string, options?: WorkerOptions) => {
    const worker = new MockWorker(url, options, config);
    instances.push(worker);
    return worker;
  });

  return {
    MockWorkerConstructor,
    getInstances: () => instances,
    getLastInstance: () => instances[instances.length - 1],
    clearInstances: () => {
      instances.length = 0;
    },
  };
}

/**
 * Helper to wait for a specific message type from worker
 */
export function waitForWorkerMessage(
  worker: MockWorker,
  type: WorkerResponse['type'],
  timeout: number = 5000
): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for message type: ${type}`));
    }, timeout);

    const handler = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.type === type) {
        clearTimeout(timer);
        worker.removeEventListener('message', handler);
        resolve(event.data);
      }
    };

    worker.addEventListener('message', handler);
  });
}
