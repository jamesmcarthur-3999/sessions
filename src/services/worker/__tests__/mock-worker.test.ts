/**
 * MockWorker Tests
 *
 * Tests for the test mock infrastructure itself.
 */

import { describe, it, expect, vi } from 'vitest';
import { MockWorker, createMockWorkerConstructor, waitForWorkerMessage } from '../../../test/mocks/worker';

describe('MockWorker', () => {
  describe('basic behavior', () => {
    it('should store URL and options', () => {
      const worker = new MockWorker('worker.js', { type: 'module' });
      expect(worker.url).toBe('worker.js');
      expect(worker.options).toEqual({ type: 'module' });
    });

    it('should auto-send ready message when autoReady is true', async () => {
      const handler = vi.fn();
      const worker = new MockWorker('worker.js', undefined, { autoReady: true });
      worker.onmessage = handler;

      // Wait for auto-ready
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'ready' }),
        })
      );
    });

    it('should not auto-send ready when autoReady is false', async () => {
      const handler = vi.fn();
      const worker = new MockWorker('worker.js', undefined, { autoReady: false });
      worker.onmessage = handler;

      await new Promise((r) => setTimeout(r, 10));

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('message tracking', () => {
    it('should track posted messages', () => {
      const worker = new MockWorker('worker.js', undefined, { autoReady: false });

      worker.postMessage({ type: 'init' } as any);
      worker.postMessage({ type: 'analyze' } as any);

      expect(worker.getMessages()).toHaveLength(2);
      expect(worker.getLastMessage()).toEqual({ type: 'analyze' });
    });

    it('should clear message queue', () => {
      const worker = new MockWorker('worker.js', undefined, { autoReady: false });

      worker.postMessage({ type: 'init' } as any);
      worker.clearMessages();

      expect(worker.getMessages()).toHaveLength(0);
    });

    it('should throw on postMessage after terminate', () => {
      const worker = new MockWorker('worker.js', undefined, { autoReady: false });
      worker.terminate();

      expect(() => worker.postMessage({ type: 'init' } as any)).toThrow(/terminated/);
    });
  });

  describe('simulate methods', () => {
    it('simulateMessage should fire onmessage', () => {
      const handler = vi.fn();
      const worker = new MockWorker('worker.js', undefined, { autoReady: false });
      worker.onmessage = handler;

      worker.simulateMessage({ type: 'ready', timestamp: 123 });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { type: 'ready', timestamp: 123 },
        })
      );
    });

    it('simulateMessage should fire addEventListener handlers', () => {
      const handler = vi.fn();
      const worker = new MockWorker('worker.js', undefined, { autoReady: false });
      worker.addEventListener('message', handler);

      worker.simulateMessage({ type: 'ready', timestamp: 123 });

      expect(handler).toHaveBeenCalled();
    });

    it('simulateError should fire onerror', () => {
      const handler = vi.fn();
      const worker = new MockWorker('worker.js', undefined, { autoReady: false });
      worker.onerror = handler;

      worker.simulateError('something broke');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'something broke' })
      );
    });

    it('simulateCrash should error and terminate', () => {
      const errorHandler = vi.fn();
      const worker = new MockWorker('worker.js', undefined, { autoReady: false });
      worker.onerror = errorHandler;

      worker.simulateCrash('fatal crash');

      expect(errorHandler).toHaveBeenCalled();
      expect(worker.terminated).toBe(true);
    });

    it('should not fire handlers after terminate', () => {
      const handler = vi.fn();
      const worker = new MockWorker('worker.js', undefined, { autoReady: false });
      worker.onmessage = handler;

      worker.terminate();
      worker.simulateMessage({ type: 'ready', timestamp: 123 });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('message delay', () => {
    it('should delay message delivery', async () => {
      const handler = vi.fn();
      const worker = new MockWorker('worker.js', undefined, {
        autoReady: false,
        messageDelay: 50,
      });
      worker.onmessage = handler;

      worker.simulateMessage({ type: 'ready', timestamp: 123 });

      // Not yet delivered
      expect(handler).not.toHaveBeenCalled();

      // Wait for delay
      await new Promise((r) => setTimeout(r, 60));

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('removeEventListener', () => {
    it('should stop receiving events after removal', () => {
      const handler = vi.fn();
      const worker = new MockWorker('worker.js', undefined, { autoReady: false });
      worker.addEventListener('message', handler);

      worker.simulateMessage({ type: 'ready', timestamp: 1 });
      expect(handler).toHaveBeenCalledTimes(1);

      worker.removeEventListener('message', handler);
      worker.simulateMessage({ type: 'ready', timestamp: 2 });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});

describe('createMockWorkerConstructor', () => {
  it('should track instances', () => {
    const { MockWorkerConstructor, getInstances, getLastInstance } = createMockWorkerConstructor({ autoReady: false });

    MockWorkerConstructor('a.js');
    const w2 = MockWorkerConstructor('b.js');

    expect(getInstances()).toHaveLength(2);
    expect(getLastInstance()).toBe(w2);
  });

  it('should clear instances', () => {
    const { MockWorkerConstructor, getInstances, clearInstances } = createMockWorkerConstructor({ autoReady: false });

    MockWorkerConstructor('a.js');
    clearInstances();

    expect(getInstances()).toHaveLength(0);
  });
});

describe('waitForWorkerMessage', () => {
  it('should resolve when matching message arrives', async () => {
    const worker = new MockWorker('worker.js', undefined, { autoReady: false });

    const promise = waitForWorkerMessage(worker, 'ready', 1000);
    worker.simulateReady();

    const result = await promise;
    expect(result.type).toBe('ready');
  });

  it('should timeout if message never arrives', async () => {
    const worker = new MockWorker('worker.js', undefined, { autoReady: false });

    await expect(
      waitForWorkerMessage(worker, 'ready', 100)
    ).rejects.toThrow(/Timeout/);
  });

  it('should ignore non-matching messages', async () => {
    const worker = new MockWorker('worker.js', undefined, { autoReady: false });

    const promise = waitForWorkerMessage(worker, 'ready', 1000);

    // Send wrong type
    worker.simulateMessage({ type: 'error', error: 'test' } as any);

    // Send correct type
    worker.simulateReady();

    const result = await promise;
    expect(result.type).toBe('ready');
  });
});
