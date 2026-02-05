/**
 * AI Worker Client Tests
 *
 * Tests for the client-side abstractions used by the AI Worker system.
 * Note: Full worker instantiation tests are difficult in vitest due to module caching.
 * These tests focus on the abstractions and event handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RequestManager } from '../request-manager';
import { WorkerStateMachine } from '../worker-state';
import { EventEmitter } from '../../event-emitter';

describe('AiWorkerClient Abstractions', () => {
  describe('RequestManager usage patterns', () => {
    let requestManager: RequestManager;

    beforeEach(() => {
      requestManager = new RequestManager({ prefix: 'worker', defaultTimeout: 60000 });
    });

    afterEach(() => {
      requestManager.destroy();
    });

    it('should generate IDs with worker prefix', () => {
      const id = requestManager.generateId();
      expect(id).toMatch(/^worker-\d+-\d+$/);
    });

    it('should track multiple concurrent requests', () => {
      requestManager.create();
      requestManager.create();
      requestManager.create();

      expect(requestManager.pendingCount).toBe(3);
    });

    it('should complete requests with correlation IDs', async () => {
      const { id, promise } = requestManager.create<{ data: string }>();

      // Simulate worker response
      requestManager.complete(id, { data: 'test' });

      const result = await promise;
      expect(result.data).toBe('test');
    });

    it('should fail requests with error messages', async () => {
      const { id, promise } = requestManager.create();

      requestManager.fail(id, 'Worker error');

      await expect(promise).rejects.toThrow('Worker error');
    });
  });

  describe('WorkerStateMachine usage patterns', () => {
    let stateMachine: WorkerStateMachine;

    beforeEach(() => {
      stateMachine = new WorkerStateMachine();
    });

    afterEach(() => {
      stateMachine.destroy();
    });

    it('should track ready state correctly', () => {
      expect(stateMachine.isReady()).toBe(false);

      stateMachine.transitionTo('BOOTSTRAPPING');
      expect(stateMachine.isReady()).toBe(false);

      stateMachine.transitionTo('READY');
      expect(stateMachine.isReady()).toBe(false);

      stateMachine.transitionTo('INITIALIZING');
      expect(stateMachine.isReady()).toBe(false);

      stateMachine.transitionTo('INITIALIZED');
      expect(stateMachine.isReady()).toBe(true);
    });

    it('should emit state change events', () => {
      const events: any[] = [];
      stateMachine.on('state-change', (e) => events.push(e));

      stateMachine.transitionTo('BOOTSTRAPPING');
      stateMachine.transitionTo('READY');

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ from: 'CREATED', to: 'BOOTSTRAPPING' });
      expect(events[1]).toMatchObject({ from: 'BOOTSTRAPPING', to: 'READY' });
    });

    it('should handle error recovery', () => {
      stateMachine.transitionTo('BOOTSTRAPPING');
      stateMachine.transitionTo('ERROR');

      expect(stateMachine.isError()).toBe(true);
      expect(stateMachine.canRecover()).toBe(true);

      // Recovery by resetting
      stateMachine.transitionTo('CREATED');
      expect(stateMachine.getState()).toBe('CREATED');
    });
  });

  describe('Event forwarding patterns', () => {
    it('should forward events through emitter', () => {
      type Events = {
        'analysis-complete': { sessionId: string; result: any };
        'error': { message: string };
      };

      const emitter = new EventEmitter<Events>();
      const analysisHandler = vi.fn();
      const errorHandler = vi.fn();

      emitter.on('analysis-complete', analysisHandler);
      emitter.on('error', errorHandler);

      // Simulate events
      emitter.emit('analysis-complete', { sessionId: 'test', result: {} });
      emitter.emit('error', { message: 'Test error' });

      expect(analysisHandler).toHaveBeenCalledWith({ sessionId: 'test', result: {} });
      expect(errorHandler).toHaveBeenCalledWith({ message: 'Test error' });
    });

    it('should support unsubscribe', () => {
      type Events = { test: { value: number } };
      const emitter = new EventEmitter<Events>();
      const handler = vi.fn();

      const unsub = emitter.on('test', handler);
      emitter.emit('test', { value: 1 });

      expect(handler).toHaveBeenCalledTimes(1);

      unsub();
      emitter.emit('test', { value: 2 });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Message correlation patterns', () => {
    it('should correlate responses to requests', async () => {
      const requestManager = new RequestManager({ prefix: 'test', defaultTimeout: 5000 });

      // Create request
      const { id, promise } = requestManager.create<{ response: string }>();

      // Simulate sending to worker
      const messageToWorker = { type: 'analyze', id, data: 'test' };
      expect(messageToWorker.id).toBe(id);

      // Simulate receiving response from worker
      const responseFromWorker = { type: 'analysis-complete', id, response: 'done' };

      // Complete the correlated request
      if (requestManager.has(responseFromWorker.id)) {
        requestManager.complete(responseFromWorker.id, responseFromWorker);
      }

      const result = await promise;
      expect(result.response).toBe('done');

      requestManager.destroy();
    });

    it('should handle multiple concurrent requests with different IDs', async () => {
      const requestManager = new RequestManager({ prefix: 'test', defaultTimeout: 5000 });

      const { id: id1, promise: p1 } = requestManager.create<number>();
      const { id: id2, promise: p2 } = requestManager.create<number>();
      const { id: id3, promise: p3 } = requestManager.create<number>();

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);

      // Complete out of order
      requestManager.complete(id2, 2);
      requestManager.complete(id3, 3);
      requestManager.complete(id1, 1);

      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

      expect(r1).toBe(1);
      expect(r2).toBe(2);
      expect(r3).toBe(3);

      requestManager.destroy();
    });
  });

  describe('Worker lifecycle simulation', () => {
    it('should simulate full worker lifecycle', () => {
      const stateMachine = new WorkerStateMachine();
      const requestManager = new RequestManager({ prefix: 'worker', defaultTimeout: 5000 });
      const lifecycle: string[] = [];

      stateMachine.on('state-change', ({ to }) => lifecycle.push(to));

      // Bootstrap
      stateMachine.transitionTo('BOOTSTRAPPING');

      // Ready - worker loaded
      stateMachine.transitionTo('READY');

      // Initialize with API keys
      stateMachine.transitionTo('INITIALIZING');
      stateMachine.transitionTo('INITIALIZED');

      // Process requests
      const { id } = requestManager.create();
      stateMachine.transitionTo('PROCESSING');

      // Complete processing
      requestManager.complete(id, {});
      stateMachine.transitionTo('INITIALIZED');

      // Terminate
      stateMachine.transitionTo('TERMINATED');

      expect(lifecycle).toEqual([
        'BOOTSTRAPPING',
        'READY',
        'INITIALIZING',
        'INITIALIZED',
        'PROCESSING',
        'INITIALIZED',
        'TERMINATED',
      ]);

      expect(requestManager.pendingCount).toBe(0);
      expect(stateMachine.isTerminated()).toBe(true);

      stateMachine.destroy();
      requestManager.destroy();
    });
  });
});
