/**
 * Message Queue - Race Condition Tests
 *
 * Tests for concurrent enqueue, handler replacement, and burst scenarios.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MessageQueue } from '../message-queue';

describe('MessageQueue Race Conditions', () => {
  let queue: MessageQueue<string>;

  beforeEach(() => {
    queue = new MessageQueue<string>({ maxSize: 200 });
  });

  describe('burst enqueue', () => {
    it('should handle burst of 100 messages sequentially', async () => {
      const processed: number[] = [];

      queue.setHandler(async (msg) => {
        processed.push(parseInt(msg));
      });

      for (let i = 0; i < 100; i++) {
        queue.enqueue(String(i));
      }

      await queue.drain();

      expect(processed).toHaveLength(100);
      // Verify sequential order
      for (let i = 0; i < 100; i++) {
        expect(processed[i]).toBe(i);
      }
    });

    it('should maintain order even with variable processing times', async () => {
      const processed: string[] = [];

      queue.setHandler(async (msg) => {
        // Simulate variable processing time
        const delay = msg === 'slow' ? 50 : 1;
        await new Promise((r) => setTimeout(r, delay));
        processed.push(msg);
      });

      queue.enqueue('slow');
      queue.enqueue('fast-1');
      queue.enqueue('fast-2');
      queue.enqueue('slow');
      queue.enqueue('fast-3');

      await queue.drain();

      expect(processed).toEqual(['slow', 'fast-1', 'fast-2', 'slow', 'fast-3']);
    });
  });

  describe('handler replacement during processing', () => {
    it('should use new handler for subsequent messages', async () => {
      const oldResults: string[] = [];
      const newResults: string[] = [];

      queue.setHandler(async (msg) => {
        oldResults.push(msg);
        // Replace handler during first message processing
        if (msg === 'trigger') {
          queue.setHandler(async (m) => {
            newResults.push(m);
          });
        }
      });

      queue.enqueue('trigger');
      queue.enqueue('after');

      await queue.drain();

      expect(oldResults).toContain('trigger');
      expect(newResults).toContain('after');
    });
  });

  describe('clear during processing', () => {
    it('should not process messages cleared during handler execution', async () => {
      const processed: string[] = [];
      let clearTriggered = false;

      queue.setHandler(async (msg) => {
        processed.push(msg);
        if (msg === 'clear-trigger' && !clearTriggered) {
          clearTriggered = true;
          queue.clear();
        }
        await new Promise((r) => setTimeout(r, 5));
      });

      queue.enqueue('first');
      queue.enqueue('clear-trigger');
      queue.enqueue('should-not-process');
      queue.enqueue('also-should-not');

      await queue.drain();

      expect(processed).toContain('first');
      expect(processed).toContain('clear-trigger');
      expect(processed).not.toContain('should-not-process');
      expect(processed).not.toContain('also-should-not');
    });
  });

  describe('enqueue during processing', () => {
    it('should process dynamically enqueued messages', async () => {
      const processed: string[] = [];

      queue.setHandler(async (msg) => {
        processed.push(msg);
        if (msg === 'spawn') {
          queue.enqueue('spawned-1');
          queue.enqueue('spawned-2');
        }
      });

      queue.enqueue('before');
      queue.enqueue('spawn');
      queue.enqueue('after');

      await queue.drain();

      expect(processed).toContain('before');
      expect(processed).toContain('spawn');
      expect(processed).toContain('after');
      expect(processed).toContain('spawned-1');
      expect(processed).toContain('spawned-2');
    });
  });

  describe('error recovery', () => {
    it('should continue processing after handler error', async () => {
      const processed: string[] = [];
      const errors: string[] = [];

      queue.setHandler(async (msg) => {
        if (msg === 'fail') {
          throw new Error('handler error');
        }
        processed.push(msg);
      });
      queue.setErrorHandler((_err, msg) => {
        errors.push(msg);
      });

      queue.enqueue('ok-1');
      queue.enqueue('fail');
      queue.enqueue('ok-2');
      queue.enqueue('fail');
      queue.enqueue('ok-3');

      await queue.drain();

      expect(processed).toEqual(['ok-1', 'ok-2', 'ok-3']);
      expect(errors).toEqual(['fail', 'fail']);
    });

    it('should track error statistics correctly after mixed operations', async () => {
      queue.setHandler(async (msg) => {
        if (msg.startsWith('err')) throw new Error('error');
      });
      queue.setErrorHandler(() => {});

      queue.enqueue('ok-1');
      queue.enqueue('err-1');
      queue.enqueue('ok-2');
      queue.enqueue('err-2');
      queue.enqueue('ok-3');

      await queue.drain();

      const stats = queue.getStats();
      expect(stats.totalProcessed).toBe(3);
      expect(stats.totalErrors).toBe(2);
    });
  });

  describe('drain behavior', () => {
    it('should resolve immediately when queue is empty', async () => {
      queue.setHandler(async () => {});

      const start = Date.now();
      await queue.drain();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(50);
    });

    it('should wait for currently processing message', async () => {
      let resolved = false;

      queue.setHandler(async () => {
        await new Promise((r) => setTimeout(r, 50));
        resolved = true;
      });

      queue.enqueue('slow');

      await queue.drain();
      expect(resolved).toBe(true);
    });

    it('multiple drain calls should all resolve', async () => {
      queue.setHandler(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });

      queue.enqueue('msg');

      const [r1, r2, r3] = await Promise.all([
        queue.drain(),
        queue.drain(),
        queue.drain(),
      ]);

      // All should resolve without error
      expect(r1).toBeUndefined();
      expect(r2).toBeUndefined();
      expect(r3).toBeUndefined();
    });
  });
});
