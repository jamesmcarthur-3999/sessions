/**
 * Worker State Machine
 *
 * Tracks worker lifecycle states and enforces valid transitions.
 * Provides state change listeners for observability.
 *
 * State diagram:
 * CREATED → BOOTSTRAPPING → READY → INITIALIZING → INITIALIZED ⇄ PROCESSING → ERROR/TERMINATED
 */

import { EventEmitter } from '../event-emitter';

// ============================================================================
// Types
// ============================================================================

export type WorkerState =
  | 'CREATED'
  | 'BOOTSTRAPPING'
  | 'READY'
  | 'INITIALIZING'
  | 'INITIALIZED'
  | 'PROCESSING'
  | 'ERROR'
  | 'TERMINATED';

export interface StateTransition {
  from: WorkerState;
  to: WorkerState;
  timestamp: number;
  reason?: string;
}

export type WorkerStateMachineEvents = {
  'state-change': StateTransition;
  error: { state: WorkerState; error: string };
};

// Valid state transitions
const VALID_TRANSITIONS: Record<WorkerState, WorkerState[]> = {
  CREATED: ['BOOTSTRAPPING', 'TERMINATED'],
  BOOTSTRAPPING: ['READY', 'ERROR', 'TERMINATED'],
  READY: ['INITIALIZING', 'TERMINATED'],
  INITIALIZING: ['INITIALIZED', 'ERROR', 'TERMINATED'],
  INITIALIZED: ['PROCESSING', 'TERMINATED'],
  PROCESSING: ['INITIALIZED', 'ERROR', 'TERMINATED'],
  ERROR: ['CREATED', 'TERMINATED'], // Can recover by re-creating
  TERMINATED: [], // Terminal state
};

// ============================================================================
// Worker State Machine
// ============================================================================

export class WorkerStateMachine {
  private state: WorkerState = 'CREATED';
  private emitter = new EventEmitter<WorkerStateMachineEvents>();

  /**
   * Get current state
   */
  getState(): WorkerState {
    return this.state;
  }

  /**
   * Check if a transition to the target state is valid
   */
  canTransitionTo(target: WorkerState): boolean {
    return VALID_TRANSITIONS[this.state].includes(target);
  }

  /**
   * Transition to a new state
   * Throws if the transition is invalid
   */
  transitionTo(target: WorkerState, reason?: string): void {
    if (!this.canTransitionTo(target)) {
      const error = `Invalid state transition: ${this.state} → ${target}`;
      this.emitter.emit('error', { state: this.state, error });
      throw new Error(error);
    }

    const transition: StateTransition = {
      from: this.state,
      to: target,
      timestamp: Date.now(),
      reason,
    };

    this.state = target;
    this.emitter.emit('state-change', transition);
  }

  /**
   * Try to transition to a new state
   * Returns false if the transition is invalid (doesn't throw)
   */
  tryTransitionTo(target: WorkerState, reason?: string): boolean {
    if (!this.canTransitionTo(target)) {
      return false;
    }
    this.transitionTo(target, reason);
    return true;
  }

  /**
   * Check if worker is in a ready state (can accept work)
   */
  isReady(): boolean {
    return this.state === 'INITIALIZED' || this.state === 'PROCESSING';
  }

  /**
   * Check if worker can be recovered
   */
  canRecover(): boolean {
    return this.state === 'ERROR';
  }

  /**
   * Check if worker is terminated
   */
  isTerminated(): boolean {
    return this.state === 'TERMINATED';
  }

  /**
   * Check if worker is in an error state
   */
  isError(): boolean {
    return this.state === 'ERROR';
  }

  /**
   * Reset to initial state (only valid from ERROR or for testing)
   */
  reset(): void {
    if (this.state !== 'ERROR' && this.state !== 'CREATED') {
      throw new Error(`Cannot reset from state: ${this.state}`);
    }
    this.state = 'CREATED';
  }

  /**
   * Subscribe to state changes
   */
  on<K extends keyof WorkerStateMachineEvents>(
    event: K,
    callback: (data: WorkerStateMachineEvents[K]) => void
  ): () => void {
    return this.emitter.on(event, callback);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.emitter.removeAllListeners();
  }
}
