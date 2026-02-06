/**
 * Request Manager Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RequestManager } from '../request-manager';

describe('RequestManager', () => {
  let manager: RequestManager;

  beforeEach(() => {
    manager = new RequestManager({ prefix: 'test', defaultTimeout: 1000 });
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('generateId', () => {
    it('should generate unique IDs with prefix', () => {
      const id1 = manager.generateId();
      const id2 = manager.generateId();

      expect(id1).toMatch(/^test-\d+-\d+$/);
      expect(id2).toMatch(/^test-\d+-\d+$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('create', () => {
    it('should create a pending request', () => {
      const { id } = manager.create();

      expect(manager.has(id)).toBe(true);
      expect(manager.pendingCount).toBe(1);
    });

    it('should emit request-created event', () => {
      const handler = vi.fn();
      manager.on('request-created', handler);

      const { id } = manager.create({ metadata: { test: true } });

      expect(handler).toHaveBeenCalledWith({
        id,
        timeout: 1000,
        metadata: { test: true },
      });
    });

});

  describe('complete', () => {
    it('should resolve the promise with result', async () => {
      const { id, promise } = manager.create<string>();

      manager.complete(id, 'success');

      await expect(promise).resolves.toBe('success');
      expect(manager.has(id)).toBe(false);
    });

    it('should emit request-completed event', async () => {
      const handler = vi.fn();
      manager.on('request-completed', handler);

      const { id, promise } = manager.create();
      manager.complete(id, 'done');
      await promise;

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id,
          duration: expect.any(Number),
        })
      );
    });

    it('should return false for non-existent request', () => {
      expect(manager.complete('non-existent', 'value')).toBe(false);
    });
  });

  describe('fail', () => {
    it('should reject the promise with error', async () => {
      const { id, promise } = manager.create();

      manager.fail(id, 'Something went wrong');

      await expect(promise).rejects.toThrow('Something went wrong');
      expect(manager.has(id)).toBe(false);
    });

    it('should emit request-failed event', async () => {
      const handler = vi.fn();
      manager.on('request-failed', handler);

      const { id, promise } = manager.create();
      manager.fail(id, 'error message');

      await expect(promise).rejects.toThrow();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id,
          error: 'error message',
          duration: expect.any(Number),
        })
      );
    });

    it('should accept Error objects', async () => {
      const { id, promise } = manager.create();

      manager.fail(id, new Error('Error object'));

      await expect(promise).rejects.toThrow('Error object');
    });
  });

  describe('timeout', () => {
    it('should reject after timeout', async () => {
      vi.useFakeTimers();

      const { id, promise } = manager.create({ timeout: 100 });

      vi.advanceTimersByTime(100);

      await expect(promise).rejects.toThrow(/timed out after 100ms/);
      expect(manager.has(id)).toBe(false);

      vi.useRealTimers();
    });

    it('should emit request-timeout event', async () => {
      vi.useFakeTimers();

      const handler = vi.fn();
      manager.on('request-timeout', handler);

      const { id, promise } = manager.create({ timeout: 100 });

      vi.advanceTimersByTime(100);

      await expect(promise).rejects.toThrow();

      expect(handler).toHaveBeenCalledWith({ id, timeout: 100 });

      vi.useRealTimers();
    });
  });

  describe('abort', () => {
    it('should reject the promise when aborted', async () => {
      const { id, promise } = manager.create();

      manager.abort(id);

      await expect(promise).rejects.toThrow(/was aborted/);
      expect(manager.has(id)).toBe(false);
    });

    it('should emit request-aborted event', async () => {
      const handler = vi.fn();
      manager.on('request-aborted', handler);

      const { id, promise } = manager.create();
      manager.abort(id);

      await expect(promise).rejects.toThrow();

      expect(handler).toHaveBeenCalledWith({ id });
    });

    it('should abort via signal', async () => {
      const controller = new AbortController();
      const { promise } = manager.create({ signal: controller.signal });

      controller.abort();

      await expect(promise).rejects.toThrow(/was aborted/);
    });
  });

  describe('abortAll', () => {
    it('should abort all pending requests', async () => {
      const { promise: p1 } = manager.create();
      const { promise: p2 } = manager.create();
      const { promise: p3 } = manager.create();

      expect(manager.pendingCount).toBe(3);

      manager.abortAll();

      await expect(p1).rejects.toThrow();
      await expect(p2).rejects.toThrow();
      await expect(p3).rejects.toThrow();

      expect(manager.pendingCount).toBe(0);
    });
  });

});
