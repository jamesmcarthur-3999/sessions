/**
 * Worker State Machine - Advanced Tests
 *
 * Tests for state transitions, error recovery, and edge cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerStateMachine } from '../worker-state';

describe('WorkerStateMachine Advanced', () => {
  let sm: WorkerStateMachine;

  beforeEach(() => {
    sm = new WorkerStateMachine();
  });

  afterEach(() => {
    sm.destroy();
  });

  describe('initial state', () => {
    it('should start in CREATED state', () => {
      expect(sm.getState()).toBe('CREATED');
    });

    it('should not be ready initially', () => {
      expect(sm.isReady()).toBe(false);
    });

    it('should not be in error initially', () => {
      expect(sm.isError()).toBe(false);
    });

    it('should not be terminated initially', () => {
      expect(sm.isTerminated()).toBe(false);
    });
  });

  describe('happy path lifecycle', () => {
    it('should follow CREATED → BOOTSTRAPPING → READY → INITIALIZING → INITIALIZED', () => {
      const states: string[] = [];
      sm.on('state-change', ({ to }) => states.push(to));

      sm.transitionTo('BOOTSTRAPPING');
      sm.transitionTo('READY');
      sm.transitionTo('INITIALIZING');
      sm.transitionTo('INITIALIZED');

      expect(states).toEqual(['BOOTSTRAPPING', 'READY', 'INITIALIZING', 'INITIALIZED']);
      expect(sm.isReady()).toBe(true);
    });

    it('should transition to PROCESSING from INITIALIZED', () => {
      sm.transitionTo('BOOTSTRAPPING');
      sm.transitionTo('READY');
      sm.transitionTo('INITIALIZING');
      sm.transitionTo('INITIALIZED');
      sm.transitionTo('PROCESSING');

      expect(sm.getState()).toBe('PROCESSING');
      expect(sm.isReady()).toBe(true); // PROCESSING is considered ready (can queue work)
    });

    it('should return to INITIALIZED after processing', () => {
      sm.transitionTo('BOOTSTRAPPING');
      sm.transitionTo('READY');
      sm.transitionTo('INITIALIZING');
      sm.transitionTo('INITIALIZED');
      sm.transitionTo('PROCESSING');
      sm.transitionTo('INITIALIZED');

      expect(sm.isReady()).toBe(true);
    });
  });

  describe('error recovery', () => {
    it('should enter error state', () => {
      sm.transitionTo('BOOTSTRAPPING');
      sm.transitionTo('ERROR');

      expect(sm.isError()).toBe(true);
      expect(sm.isReady()).toBe(false);
    });

    it('should allow recovery from error', () => {
      sm.transitionTo('BOOTSTRAPPING');
      sm.transitionTo('ERROR');

      expect(sm.canRecover()).toBe(true);

      sm.transitionTo('CREATED');
      expect(sm.getState()).toBe('CREATED');
      expect(sm.isError()).toBe(false);
    });

    it('should track error from any state', () => {
      // Error from INITIALIZING
      sm.transitionTo('BOOTSTRAPPING');
      sm.transitionTo('READY');
      sm.transitionTo('INITIALIZING');
      sm.transitionTo('ERROR');

      expect(sm.isError()).toBe(true);
    });
  });

  describe('termination', () => {
    it('should terminate cleanly', () => {
      sm.transitionTo('BOOTSTRAPPING');
      sm.transitionTo('READY');
      sm.transitionTo('INITIALIZING');
      sm.transitionTo('INITIALIZED');
      sm.transitionTo('TERMINATED');

      expect(sm.isTerminated()).toBe(true);
      expect(sm.isReady()).toBe(false);
    });

    it('should not be recoverable after termination', () => {
      sm.transitionTo('TERMINATED');
      expect(sm.canRecover()).toBe(false);
    });
  });

  describe('event emission', () => {
    it('should emit state-change with from and to', () => {
      const handler = vi.fn();
      sm.on('state-change', handler);

      sm.transitionTo('BOOTSTRAPPING');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'CREATED',
          to: 'BOOTSTRAPPING',
        })
      );
    });

    it('should support unsubscribe', () => {
      const handler = vi.fn();
      const unsub = sm.on('state-change', handler);

      sm.transitionTo('BOOTSTRAPPING');
      expect(handler).toHaveBeenCalledTimes(1);

      unsub();
      sm.transitionTo('READY');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should stop emitting after destroy', () => {
      const handler = vi.fn();
      sm.on('state-change', handler);

      sm.destroy();
      sm.transitionTo('BOOTSTRAPPING');

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('rapid transitions', () => {
    it('should handle rapid sequential transitions', () => {
      const states: string[] = [];
      sm.on('state-change', ({ to }) => states.push(to));

      sm.transitionTo('BOOTSTRAPPING');
      sm.transitionTo('READY');
      sm.transitionTo('INITIALIZING');
      sm.transitionTo('INITIALIZED');
      sm.transitionTo('PROCESSING');
      sm.transitionTo('INITIALIZED');
      sm.transitionTo('PROCESSING');
      sm.transitionTo('INITIALIZED');

      expect(states).toEqual([
        'BOOTSTRAPPING', 'READY', 'INITIALIZING', 'INITIALIZED',
        'PROCESSING', 'INITIALIZED', 'PROCESSING', 'INITIALIZED',
      ]);
    });
  });
});
