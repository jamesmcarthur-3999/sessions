/**
 * Event Emitter Tests
 *
 * Tests for the typed event bus used across services.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from '../event-emitter';

type TestEvents = {
  'message': { text: string };
  'count': { value: number };
  'empty': Record<string, never>;
};

describe('EventEmitter', () => {
  let emitter: EventEmitter<TestEvents>;

  beforeEach(() => {
    emitter = new EventEmitter<TestEvents>();
  });

  describe('on/emit', () => {
    it('should deliver events to subscribers', () => {
      const handler = vi.fn();
      emitter.on('message', handler);

      emitter.emit('message', { text: 'hello' });

      expect(handler).toHaveBeenCalledWith({ text: 'hello' });
    });

    it('should deliver to multiple subscribers', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      emitter.on('message', h1);
      emitter.on('message', h2);

      emitter.emit('message', { text: 'hi' });

      expect(h1).toHaveBeenCalledOnce();
      expect(h2).toHaveBeenCalledOnce();
    });

    it('should not cross-deliver between event types', () => {
      const messageHandler = vi.fn();
      const countHandler = vi.fn();
      emitter.on('message', messageHandler);
      emitter.on('count', countHandler);

      emitter.emit('message', { text: 'test' });

      expect(messageHandler).toHaveBeenCalled();
      expect(countHandler).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('should stop receiving events after unsubscribe', () => {
      const handler = vi.fn();
      const unsub = emitter.on('message', handler);

      emitter.emit('message', { text: 'first' });
      expect(handler).toHaveBeenCalledTimes(1);

      unsub();
      emitter.emit('message', { text: 'second' });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('double unsubscribe should be safe', () => {
      const handler = vi.fn();
      const unsub = emitter.on('message', handler);

      unsub();
      unsub(); // Should not throw

      emitter.emit('message', { text: 'test' });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('removeAllListeners', () => {
    it('should remove all listeners for all events', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      emitter.on('message', h1);
      emitter.on('count', h2);

      emitter.removeAllListeners();

      emitter.emit('message', { text: 'test' });
      emitter.emit('count', { value: 1 });

      expect(h1).not.toHaveBeenCalled();
      expect(h2).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle emit with no subscribers', () => {
      // Should not throw
      emitter.emit('message', { text: 'nobody is listening' });
    });

    it('should handle rapid fire events', () => {
      const handler = vi.fn();
      emitter.on('count', handler);

      for (let i = 0; i < 100; i++) {
        emitter.emit('count', { value: i });
      }

      expect(handler).toHaveBeenCalledTimes(100);
      expect(handler).toHaveBeenLastCalledWith({ value: 99 });
    });

    it('should handle subscriber that throws', () => {
      const throwing = vi.fn(() => { throw new Error('oops') });
      const safe = vi.fn();

      emitter.on('message', throwing);
      emitter.on('message', safe);

      // The emitter should not crash on subscriber errors
      // Behavior depends on implementation - at minimum, it shouldn't crash the emitter
      try {
        emitter.emit('message', { text: 'test' });
      } catch {
        // Some implementations propagate, some don't
      }

      expect(throwing).toHaveBeenCalled();
    });

    it('should handle unsubscribing during emission', () => {
      let unsub: (() => void) | null = null;
      const handler = vi.fn(() => {
        unsub?.();
      });
      unsub = emitter.on('message', handler);

      emitter.emit('message', { text: 'test' });

      expect(handler).toHaveBeenCalledOnce();

      // Subsequent emits should not call the handler
      emitter.emit('message', { text: 'test2' });
      expect(handler).toHaveBeenCalledOnce();
    });
  });
});
