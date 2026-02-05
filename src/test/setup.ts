/**
 * Test Setup
 *
 * Global test configuration and mocks for Vitest.
 */

import { vi, beforeAll, afterAll, afterEach } from 'vitest';

// Mock window object for non-browser environments
if (typeof window === 'undefined') {
  (global as any).window = {};
}

// Mock Tauri APIs
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
}));

// Mock secure storage
vi.mock('../services/secure-storage', () => ({
  getSecureItem: vi.fn(() => Promise.resolve(null)),
  setSecureItem: vi.fn(() => Promise.resolve()),
  removeSecureItem: vi.fn(() => Promise.resolve()),
}));

// Mock Worker in non-worker environments
if (typeof Worker === 'undefined') {
  class MockWorker {
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    url: URL | string;
    options?: WorkerOptions;
    private listeners = new Map<string, Set<EventListener>>();

    constructor(url: URL | string, options?: WorkerOptions) {
      this.url = url;
      this.options = options;
    }

    postMessage(_message: any): void {
      // Subclasses can override to simulate responses
    }

    terminate(): void {
      this.listeners.clear();
    }

    addEventListener(type: string, listener: EventListener): void {
      if (!this.listeners.has(type)) {
        this.listeners.set(type, new Set());
      }
      this.listeners.get(type)!.add(listener);
    }

    removeEventListener(type: string, listener: EventListener): void {
      this.listeners.get(type)?.delete(listener);
    }

    dispatchEvent(event: Event): boolean {
      const listeners = this.listeners.get(event.type);
      if (listeners) {
        listeners.forEach((l) => l(event));
      }
      return true;
    }

    // Test helper to simulate messages from worker
    _simulateMessage(data: any): void {
      const event = new MessageEvent('message', { data });
      if (this.onmessage) {
        this.onmessage(event);
      }
      this.dispatchEvent(event);
    }

    // Test helper to simulate errors
    _simulateError(message: string): void {
      const event = new ErrorEvent('error', { message });
      if (this.onerror) {
        this.onerror(event);
      }
      this.dispatchEvent(event);
    }
  }

  (global as any).Worker = MockWorker;
}

// Clean up after each test
afterEach(() => {
  vi.clearAllMocks();
});

// Global test lifecycle hooks
beforeAll(() => {
  // Console methods spy for checking logs in tests
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});
