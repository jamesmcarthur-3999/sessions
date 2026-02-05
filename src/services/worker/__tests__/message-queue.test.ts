/**
 * Message Queue Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageQueue } from '../message-queue';

describe('MessageQueue', () => {
  let queue: MessageQueue<string>;

  beforeEach(() => {
    queue = new MessageQueue<string>();
  });

  describe('basic functionality', () => {
    it('should process messages in order', async () => {
      const processed: string[] = [];

      queue.setHandler(async (msg) => {
        processed.push(msg);
      });

      queue.enqueue('first');
      queue.enqueue('second');
      queue.enqueue('third');

      await queue.drain();

      expect(processed).toEqual(['first', 'second', 'third']);
    });

    it('should process messages sequentially', async () => {
      const order: number[] = [];

      queue.setHandler(async (msg) => {
        const delay = msg === 'slow' ? 50 : 10;
        await new Promise((r) => setTimeout(r, delay));
        order.push(parseInt(msg.split('-')[1] || '0'));
      });

      queue.enqueue('slow');
      queue.enqueue('msg-1');
      queue.enqueue('msg-2');

      await queue.drain();

      // Even though "slow" takes longer, it should complete first
      expect(order).toEqual([0, 1, 2]);
    });
  });

  describe('error handling', () => {
    it('should call error handler on processing errors', async () => {
      const errorHandler = vi.fn();
      queue.setHandler(async (msg) => {
        if (msg === 'fail') {
          throw new Error('Processing failed');
        }
      });
      queue.setErrorHandler(errorHandler);

      queue.enqueue('ok');
      queue.enqueue('fail');
      queue.enqueue('also-ok');

      await queue.drain();

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler).toHaveBeenCalledWith(expect.any(Error), 'fail');
    });

    it('should continue processing after error by default', async () => {
      const processed: string[] = [];

      queue.setHandler(async (msg) => {
        if (msg === 'fail') {
          throw new Error('Error');
        }
        processed.push(msg);
      });
      queue.setErrorHandler(() => {}); // Swallow errors

      queue.enqueue('first');
      queue.enqueue('fail');
      queue.enqueue('third');

      await queue.drain();

      expect(processed).toEqual(['first', 'third']);
    });

    it('should clear queue on error when clearOnError is true', async () => {
      const clearQueue = new MessageQueue<string>({ clearOnError: true });
      const processed: string[] = [];

      clearQueue.setHandler(async (msg) => {
        if (msg === 'fail') {
          throw new Error('Error');
        }
        processed.push(msg);
      });
      clearQueue.setErrorHandler(() => {});

      clearQueue.enqueue('first');
      clearQueue.enqueue('fail');
      clearQueue.enqueue('third');

      await clearQueue.drain();

      // 'third' should not be processed because queue was cleared
      expect(processed).toEqual(['first']);
    });
  });

  describe('statistics', () => {
    it('should track processed messages', async () => {
      queue.setHandler(async () => {});

      queue.enqueue('a');
      queue.enqueue('b');
      queue.enqueue('c');

      await queue.drain();

      const stats = queue.getStats();
      expect(stats.totalProcessed).toBe(3);
      expect(stats.totalErrors).toBe(0);
    });

    it('should track errors', async () => {
      queue.setHandler(async (msg) => {
        if (msg.startsWith('err')) {
          throw new Error('Error');
        }
      });
      queue.setErrorHandler(() => {});

      queue.enqueue('ok1');
      queue.enqueue('err1');
      queue.enqueue('ok2');
      queue.enqueue('err2');

      await queue.drain();

      const stats = queue.getStats();
      expect(stats.totalProcessed).toBe(2);
      expect(stats.totalErrors).toBe(2);
    });

    it('should track queue size', () => {
      // Don't set handler so messages accumulate
      queue.enqueue('a');
      queue.enqueue('b');
      queue.enqueue('c');

      expect(queue.size).toBe(3);
    });

    it('should track processing state', async () => {
      let isProcessingDuringHandler = false;

      queue.setHandler(async () => {
        isProcessingDuringHandler = queue.processing;
        await new Promise((r) => setTimeout(r, 10));
      });

      queue.enqueue('test');

      await queue.drain();

      expect(isProcessingDuringHandler).toBe(true);
      expect(queue.processing).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all pending messages', () => {
      queue.enqueue('a');
      queue.enqueue('b');
      queue.enqueue('c');

      queue.clear();

      expect(queue.size).toBe(0);
    });
  });

  describe('resetStats', () => {
    it('should reset statistics', async () => {
      queue.setHandler(async () => {});

      queue.enqueue('a');
      queue.enqueue('b');

      await queue.drain();

      expect(queue.getStats().totalProcessed).toBe(2);

      queue.resetStats();

      expect(queue.getStats().totalProcessed).toBe(0);
      expect(queue.getStats().totalErrors).toBe(0);
    });
  });

  describe('drain', () => {
    it('should wait for all messages to be processed', async () => {
      const processed: string[] = [];

      queue.setHandler(async (msg) => {
        await new Promise((r) => setTimeout(r, 10));
        processed.push(msg);
      });

      queue.enqueue('a');
      queue.enqueue('b');
      queue.enqueue('c');

      // Before drain, queue might still be processing
      await queue.drain();

      // After drain, all messages should be processed
      expect(processed).toEqual(['a', 'b', 'c']);
      expect(queue.size).toBe(0);
      expect(queue.processing).toBe(false);
    });
  });
});
