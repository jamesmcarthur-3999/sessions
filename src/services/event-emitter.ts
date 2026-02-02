/**
 * Simple typed event emitter
 */

type Listener<T> = (data: T) => void;

export class EventEmitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<Listener<unknown>>>();

  on<K extends keyof Events>(event: K, callback: Listener<Events[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback as Listener<unknown>);

    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(callback as Listener<unknown>);
    };
  }

  emit<K extends keyof Events>(event: K, data: Events[K]): void {
    this.listeners.get(event)?.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error('Error in event listener for ' + String(event) + ':', error);
      }
    });
  }

  off<K extends keyof Events>(event: K, callback: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(callback as Listener<unknown>);
  }

  removeAllListeners(event?: keyof Events): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}
