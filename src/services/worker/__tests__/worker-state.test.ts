/**
 * Worker State Machine Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerStateMachine } from '../worker-state';

describe('WorkerStateMachine', () => {
  let machine: WorkerStateMachine;

  beforeEach(() => {
    machine = new WorkerStateMachine();
  });

  afterEach(() => {
    machine.destroy();
  });

  describe('initial state', () => {
    it('should start in CREATED state', () => {
      expect(machine.getState()).toBe('CREATED');
    });

    it('should not be ready initially', () => {
      expect(machine.isReady()).toBe(false);
    });

    it('should not be terminated initially', () => {
      expect(machine.isTerminated()).toBe(false);
    });
  });

  describe('transitionTo', () => {
    it('should allow valid transitions', () => {
      machine.transitionTo('BOOTSTRAPPING');
      expect(machine.getState()).toBe('BOOTSTRAPPING');

      machine.transitionTo('READY');
      expect(machine.getState()).toBe('READY');
    });

    it('should throw on invalid transitions', () => {
      expect(() => machine.transitionTo('INITIALIZED')).toThrow(
        'Invalid state transition: CREATED → INITIALIZED'
      );
    });

    it('should emit state-change event', () => {
      const handler = vi.fn();
      machine.on('state-change', handler);

      machine.transitionTo('BOOTSTRAPPING', 'Starting up');

      expect(handler).toHaveBeenCalledWith({
        from: 'CREATED',
        to: 'BOOTSTRAPPING',
        timestamp: expect.any(Number),
        reason: 'Starting up',
      });
    });

    it('should emit error event on invalid transition', () => {
      const handler = vi.fn();
      machine.on('error', handler);

      expect(() => machine.transitionTo('INITIALIZED')).toThrow();

      expect(handler).toHaveBeenCalledWith({
        state: 'CREATED',
        error: 'Invalid state transition: CREATED → INITIALIZED',
      });
    });
  });

  describe('tryTransitionTo', () => {
    it('should return true and transition on valid transition', () => {
      const result = machine.tryTransitionTo('BOOTSTRAPPING');

      expect(result).toBe(true);
      expect(machine.getState()).toBe('BOOTSTRAPPING');
    });

    it('should return false on invalid transition (no throw)', () => {
      const result = machine.tryTransitionTo('INITIALIZED');

      expect(result).toBe(false);
      expect(machine.getState()).toBe('CREATED');
    });
  });

  describe('canTransitionTo', () => {
    it('should return true for valid transitions', () => {
      expect(machine.canTransitionTo('BOOTSTRAPPING')).toBe(true);
      expect(machine.canTransitionTo('TERMINATED')).toBe(true);
    });

    it('should return false for invalid transitions', () => {
      expect(machine.canTransitionTo('READY')).toBe(false);
      expect(machine.canTransitionTo('INITIALIZED')).toBe(false);
    });
  });

  describe('isReady', () => {
    it('should return true when INITIALIZED', () => {
      machine.transitionTo('BOOTSTRAPPING');
      machine.transitionTo('READY');
      machine.transitionTo('INITIALIZING');
      machine.transitionTo('INITIALIZED');

      expect(machine.isReady()).toBe(true);
    });

    it('should return true when PROCESSING', () => {
      machine.transitionTo('BOOTSTRAPPING');
      machine.transitionTo('READY');
      machine.transitionTo('INITIALIZING');
      machine.transitionTo('INITIALIZED');
      machine.transitionTo('PROCESSING');

      expect(machine.isReady()).toBe(true);
    });

    it('should return false in other states', () => {
      expect(machine.isReady()).toBe(false);

      machine.transitionTo('BOOTSTRAPPING');
      expect(machine.isReady()).toBe(false);

      machine.transitionTo('READY');
      expect(machine.isReady()).toBe(false);
    });
  });

  describe('isError and canRecover', () => {
    it('should identify error state', () => {
      machine.transitionTo('BOOTSTRAPPING');
      machine.transitionTo('ERROR');

      expect(machine.isError()).toBe(true);
      expect(machine.canRecover()).toBe(true);
    });
  });

  describe('reset', () => {
    it('should reset from ERROR state', () => {
      machine.transitionTo('BOOTSTRAPPING');
      machine.transitionTo('ERROR');

      machine.reset();

      expect(machine.getState()).toBe('CREATED');
    });

    it('should throw when resetting from non-ERROR state', () => {
      machine.transitionTo('BOOTSTRAPPING');

      expect(() => machine.reset()).toThrow('Cannot reset from state: BOOTSTRAPPING');
    });
  });

  describe('full lifecycle', () => {
    it('should support full happy path', () => {
      // Worker created → bootstrapping → ready → initializing → initialized → processing → back to initialized
      machine.transitionTo('BOOTSTRAPPING');
      machine.transitionTo('READY');
      machine.transitionTo('INITIALIZING');
      machine.transitionTo('INITIALIZED');
      machine.transitionTo('PROCESSING');
      machine.transitionTo('INITIALIZED');
      machine.transitionTo('PROCESSING');
      machine.transitionTo('TERMINATED');

      expect(machine.isTerminated()).toBe(true);
    });

    it('should support error recovery path', () => {
      machine.transitionTo('BOOTSTRAPPING');
      machine.transitionTo('ERROR');

      expect(machine.canRecover()).toBe(true);

      machine.transitionTo('CREATED');
      machine.transitionTo('BOOTSTRAPPING');
      machine.transitionTo('READY');

      expect(machine.getState()).toBe('READY');
    });
  });
});
