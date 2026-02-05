/**
 * Worker Flow Integration Tests
 *
 * End-to-end tests for the worker communication flow.
 * Tests the complete path from client through worker and back.
 */

import { describe, it, expect, vi } from 'vitest';
import { RequestManager } from '../../worker/request-manager';
import { WorkerStateMachine } from '../../worker/worker-state';
import { MessageQueue } from '../../worker/message-queue';

describe('Worker Flow Integration', () => {
  describe('RequestManager + MessageQueue coordination', () => {
    it('should process requests sequentially and track completion', async () => {
      const requestManager = new RequestManager({ prefix: 'test', defaultTimeout: 5000 });
      const messageQueue = new MessageQueue<{ type: string; id: string }>();
      const processedIds: string[] = [];

      // Set up message handler that completes requests
      messageQueue.setHandler(async (msg) => {
        await new Promise((r) => setTimeout(r, 10)); // Simulate work
        processedIds.push(msg.id);
        requestManager.complete(msg.id, { result: 'done' });
      });

      // Create multiple requests
      const { id: id1, promise: p1 } = requestManager.create();
      const { id: id2, promise: p2 } = requestManager.create();
      const { id: id3, promise: p3 } = requestManager.create();

      // Enqueue messages
      messageQueue.enqueue({ type: 'test', id: id1 });
      messageQueue.enqueue({ type: 'test', id: id2 });
      messageQueue.enqueue({ type: 'test', id: id3 });

      // Wait for all to complete
      const results = await Promise.all([p1, p2, p3]);

      expect(results).toHaveLength(3);
      expect(processedIds).toEqual([id1, id2, id3]); // Sequential order
      expect(requestManager.pendingCount).toBe(0);

      requestManager.destroy();
    });

    it('should handle request timeout independently of queue', async () => {
      vi.useFakeTimers();

      const requestManager = new RequestManager({ prefix: 'test', defaultTimeout: 100 });

      // Don't set up handler - messages won't be processed
      const { promise } = requestManager.create({ timeout: 100 });

      // Advance time past timeout
      vi.advanceTimersByTime(100);

      await expect(promise).rejects.toThrow(/timed out/);

      requestManager.destroy();
      vi.useRealTimers();
    });
  });

  describe('WorkerStateMachine transitions', () => {
    it('should track full worker lifecycle', () => {
      const machine = new WorkerStateMachine();
      const transitions: string[] = [];

      machine.on('state-change', ({ from, to }) => {
        transitions.push(`${from}->${to}`);
      });

      // Full lifecycle
      machine.transitionTo('BOOTSTRAPPING');
      machine.transitionTo('READY');
      machine.transitionTo('INITIALIZING');
      machine.transitionTo('INITIALIZED');
      machine.transitionTo('PROCESSING');
      machine.transitionTo('INITIALIZED');
      machine.transitionTo('TERMINATED');

      expect(transitions).toEqual([
        'CREATED->BOOTSTRAPPING',
        'BOOTSTRAPPING->READY',
        'READY->INITIALIZING',
        'INITIALIZING->INITIALIZED',
        'INITIALIZED->PROCESSING',
        'PROCESSING->INITIALIZED',
        'INITIALIZED->TERMINATED',
      ]);

      machine.destroy();
    });

    it('should support error recovery', () => {
      const machine = new WorkerStateMachine();

      machine.transitionTo('BOOTSTRAPPING');
      machine.transitionTo('ERROR');

      expect(machine.isError()).toBe(true);
      expect(machine.canRecover()).toBe(true);

      // Recovery
      machine.transitionTo('CREATED');
      machine.transitionTo('BOOTSTRAPPING');
      machine.transitionTo('READY');

      expect(machine.getState()).toBe('READY');

      machine.destroy();
    });
  });

  describe('MessageQueue error handling', () => {
    it('should continue processing after error with default config', async () => {
      const messageQueue = new MessageQueue<number>({ clearOnError: false });
      const processed: number[] = [];
      const errors: number[] = [];

      messageQueue.setHandler(async (n) => {
        if (n === 2) throw new Error('Error on 2');
        processed.push(n);
      });

      messageQueue.setErrorHandler((_, n) => {
        errors.push(n);
      });

      messageQueue.enqueue(1);
      messageQueue.enqueue(2);
      messageQueue.enqueue(3);

      await messageQueue.drain();

      expect(processed).toEqual([1, 3]);
      expect(errors).toEqual([2]);
    });

    it('should stop processing after error with clearOnError', async () => {
      const messageQueue = new MessageQueue<number>({ clearOnError: true });
      const processed: number[] = [];

      messageQueue.setHandler(async (n) => {
        if (n === 2) throw new Error('Error on 2');
        processed.push(n);
      });

      messageQueue.setErrorHandler(() => {});

      messageQueue.enqueue(1);
      messageQueue.enqueue(2);
      messageQueue.enqueue(3);

      await messageQueue.drain();

      expect(processed).toEqual([1]);
      // 3 was cleared from queue
    });
  });

  describe('Full request lifecycle simulation', () => {
    it('should simulate screenshot analysis flow', async () => {
      const requestManager = new RequestManager({ prefix: 'worker', defaultTimeout: 5000 });
      const messageQueue = new MessageQueue<any>();
      const stateMachine = new WorkerStateMachine();
      const events: string[] = [];

      // Track state changes
      stateMachine.on('state-change', ({ to }) => {
        events.push(`state:${to}`);
      });

      // Simulate worker message handler
      messageQueue.setHandler(async (msg) => {
        events.push(`received:${msg.type}`);

        if (msg.type === 'analyze-screenshot') {
          // Simulate processing
          stateMachine.tryTransitionTo('PROCESSING');

          await new Promise((r) => setTimeout(r, 10));

          // Complete the request
          requestManager.complete(msg.id, {
            sessionId: msg.sessionId,
            analysis: { context: 'test' },
          });

          stateMachine.tryTransitionTo('INITIALIZED');
        }
      });

      // Initialize state machine
      stateMachine.transitionTo('BOOTSTRAPPING');
      stateMachine.transitionTo('READY');
      stateMachine.transitionTo('INITIALIZING');
      stateMachine.transitionTo('INITIALIZED');

      // Create and send request
      const { id, promise } = requestManager.create<any>();
      messageQueue.enqueue({
        type: 'analyze-screenshot',
        id,
        sessionId: 'session-1',
        screenshotId: 'screenshot-1',
        imageBase64: 'data',
      });

      // Wait for result
      const result = await promise;

      expect(result.analysis.context).toBe('test');
      expect(events).toContain('state:PROCESSING');
      expect(events).toContain('received:analyze-screenshot');

      requestManager.destroy();
      stateMachine.destroy();
    });

    it('should handle concurrent requests correctly', async () => {
      const requestManager = new RequestManager({ prefix: 'worker', defaultTimeout: 5000 });
      const messageQueue = new MessageQueue<any>();
      const completionOrder: string[] = [];

      messageQueue.setHandler(async (msg) => {
        // Simulate variable processing time
        const delay = msg.type === 'fast' ? 10 : 50;
        await new Promise((r) => setTimeout(r, delay));
        completionOrder.push(msg.id);
        requestManager.complete(msg.id, { id: msg.id });
      });

      // Create requests
      const { id: id1, promise: p1 } = requestManager.create();
      const { id: id2, promise: p2 } = requestManager.create();
      const { id: id3, promise: p3 } = requestManager.create();

      // Enqueue in order: slow, fast, slow
      // Queue processes sequentially, so order should be preserved
      messageQueue.enqueue({ type: 'slow', id: id1 });
      messageQueue.enqueue({ type: 'fast', id: id2 });
      messageQueue.enqueue({ type: 'slow', id: id3 });

      await Promise.all([p1, p2, p3]);

      // Sequential processing means order is preserved
      expect(completionOrder).toEqual([id1, id2, id3]);

      requestManager.destroy();
    });
  });
});
