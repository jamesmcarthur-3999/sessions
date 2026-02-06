/**
 * Request Manager - Advanced Tests
 *
 * Tests for timeout, abort, concurrent requests, and edge cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RequestManager } from '../request-manager';

describe('RequestManager Advanced', () => {
  let manager: RequestManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new RequestManager({ prefix: 'test', defaultTimeout: 5000 });
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  describe('timeouts', () => {
    it('should reject on timeout', async () => {
      const { promise } = manager.create<string>();

      vi.advanceTimersByTime(5001);

      await expect(promise).rejects.toThrow(/timed out/);
    });

    it('should use custom timeout when provided', async () => {
      const { promise } = manager.create<string>({ timeout: 1000 });

      vi.advanceTimersByTime(999);
      // Should not have timed out yet
      expect(manager.pendingCount).toBe(1);

      vi.advanceTimersByTime(2);
      await expect(promise).rejects.toThrow(/timed out/);
    });

    it('should emit timeout event', async () => {
      const timeoutHandler = vi.fn();
      manager.on('request-timeout', timeoutHandler);

      const { id, promise } = manager.create({ timeout: 1000 });

      vi.advanceTimersByTime(1001);

      await promise.catch(() => {}); // Suppress rejection
      expect(timeoutHandler).toHaveBeenCalledWith({ id, timeout: 1000 });
    });

    it('should not timeout if completed before deadline', async () => {
      const { id, promise } = manager.create<string>({ timeout: 1000 });

      manager.complete(id, 'done');
      vi.advanceTimersByTime(2000);

      const result = await promise;
      expect(result).toBe('done');
    });
  });

  describe('abort', () => {
    it('should reject on abort', async () => {
      const { id, promise } = manager.create<string>();

      manager.abort(id);

      await expect(promise).rejects.toThrow(/aborted/);
    });

    it('should emit abort event', async () => {
      const abortHandler = vi.fn();
      manager.on('request-aborted', abortHandler);

      const { id, promise } = manager.create();

      manager.abort(id);

      await promise.catch(() => {}); // Suppress rejection
      expect(abortHandler).toHaveBeenCalledWith({ id });
    });

    it('should support silent abort', async () => {
      const abortHandler = vi.fn();
      manager.on('request-aborted', abortHandler);

      const { id } = manager.create();

      manager.abort(id, true);

      expect(abortHandler).not.toHaveBeenCalled();
      expect(manager.pendingCount).toBe(0);
    });

    it('should abort via AbortSignal', async () => {
      const controller = new AbortController();
      const { promise } = manager.create({ signal: controller.signal });

      controller.abort();

      await expect(promise).rejects.toThrow(/aborted/);
    });

    it('abortAll should reject all pending requests', async () => {
      const { promise: p1 } = manager.create<string>();
      const { promise: p2 } = manager.create<string>();
      const { promise: p3 } = manager.create<string>();

      manager.abortAll();

      await expect(p1).rejects.toThrow(/aborted/);
      await expect(p2).rejects.toThrow(/aborted/);
      await expect(p3).rejects.toThrow(/aborted/);
      expect(manager.pendingCount).toBe(0);
    });

    it('abortAll silent should not reject', () => {
      manager.create();
      manager.create();

      manager.abortAll(true);

      expect(manager.pendingCount).toBe(0);
    });
  });

  describe('events', () => {
    it('should emit request-created on create', () => {
      const handler = vi.fn();
      manager.on('request-created', handler);

      const { id } = manager.create({ timeout: 3000, metadata: { type: 'test' } });

      expect(handler).toHaveBeenCalledWith({
        id,
        timeout: 3000,
        metadata: { type: 'test' },
      });
    });

    it('should emit request-completed on success', async () => {
      const handler = vi.fn();
      manager.on('request-completed', handler);

      const { id, promise } = manager.create<string>();
      manager.complete(id, 'result');

      await promise;

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id }));
      expect(handler.mock.calls[0][0].duration).toBeGreaterThanOrEqual(0);
    });

    it('should emit request-failed on failure', async () => {
      const handler = vi.fn();
      manager.on('request-failed', handler);

      const { id, promise } = manager.create();
      manager.fail(id, 'something broke');

      await promise.catch(() => {});

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ id, error: 'something broke' })
      );
    });
  });

  describe('edge cases', () => {
    it('complete on non-existent ID returns false', () => {
      expect(manager.complete('doesnt-exist', 'value')).toBe(false);
    });

    it('fail on non-existent ID returns false', () => {
      expect(manager.fail('doesnt-exist', 'error')).toBe(false);
    });

    it('abort on non-existent ID returns false', () => {
      expect(manager.abort('doesnt-exist')).toBe(false);
    });

    it('has returns false for non-existent ID', () => {
      expect(manager.has('nope')).toBe(false);
    });

    it('has returns true for pending request', () => {
      const { id } = manager.create();
      expect(manager.has(id)).toBe(true);
    });

    it('has returns false after completion', async () => {
      const { id, promise } = manager.create<string>();
      manager.complete(id, 'done');
      await promise;
      expect(manager.has(id)).toBe(false);
    });

    it('double complete should be safe', async () => {
      const { id, promise } = manager.create<string>();
      expect(manager.complete(id, 'first')).toBe(true);
      expect(manager.complete(id, 'second')).toBe(false);

      const result = await promise;
      expect(result).toBe('first');
    });

    it('fail after complete should be safe', async () => {
      const { id, promise } = manager.create<string>();
      manager.complete(id, 'done');
      expect(manager.fail(id, 'error')).toBe(false);

      const result = await promise;
      expect(result).toBe('done');
    });

    it('destroy should clean up all resources', () => {
      manager.create();
      manager.create();
      manager.create();

      manager.destroy();

      expect(manager.pendingCount).toBe(0);
    });
  });

  describe('concurrency', () => {
    it('should handle many concurrent requests', async () => {
      vi.useRealTimers(); // Need real timers for this test

      const count = 50;
      const requests = Array.from({ length: count }, () =>
        manager.create<number>()
      );

      expect(manager.pendingCount).toBe(count);

      // Complete all in reverse order
      for (let i = count - 1; i >= 0; i--) {
        manager.complete(requests[i].id, i);
      }

      const results = await Promise.all(requests.map(r => r.promise));
      expect(results).toEqual(Array.from({ length: count }, (_, i) => i));
      expect(manager.pendingCount).toBe(0);
    });

    it('should generate unique IDs even under rapid creation', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const { id } = manager.create();
        ids.add(id);
        // Clean up to avoid timeout issues
        manager.complete(id, null);
      }
      expect(ids.size).toBe(100);
    });
  });
});
