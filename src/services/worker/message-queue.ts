/**
 * Message Queue
 *
 * Ensures sequential async processing of worker messages.
 * Prevents race conditions from concurrent message handling.
 *
 * Features:
 * - Sequential processing guarantee
 * - Queue size tracking
 * - Clear on error
 * - Processing state tracking
 */

// ============================================================================
// Types
// ============================================================================

export interface QueuedMessage<T = unknown> {
  data: T;
  timestamp: number;
}

export interface MessageQueueStats {
  queueSize: number;
  isProcessing: boolean;
  totalProcessed: number;
  totalErrors: number;
  totalDropped: number;
}

// ============================================================================
// Message Queue
// ============================================================================

export class MessageQueue<T = unknown> {
  private queue: QueuedMessage<T>[] = [];
  private isProcessing = false;
  private totalProcessed = 0;
  private totalErrors = 0;
  private totalDropped = 0;
  private handler: ((message: T) => Promise<void>) | null = null;
  private errorHandler: ((error: Error, message: T) => void) | null = null;
  private onDrop: ((message: T) => void) | null = null;
  private clearOnError: boolean;
  private maxSize: number;

  constructor(options: { clearOnError?: boolean; maxSize?: number; onDrop?: (message: T) => void } = {}) {
    this.clearOnError = options.clearOnError ?? false;
    this.maxSize = options.maxSize ?? 50; // Default max queue size
    this.onDrop = options.onDrop ?? null;
  }

  /**
   * Set the message handler
   * Must be set before enqueueing messages
   */
  setHandler(handler: (message: T) => Promise<void>): void {
    this.handler = handler;
  }

  /**
   * Set the error handler
   */
  setErrorHandler(handler: (error: Error, message: T) => void): void {
    this.errorHandler = handler;
  }

  /**
   * Add a message to the queue and start processing if not already running
   * If queue is at max size, drops oldest non-critical messages to make room
   */
  enqueue(message: T): void {
    // If queue is at capacity, drop oldest message (backpressure)
    if (this.queue.length >= this.maxSize) {
      const dropped = this.queue.shift()!;
      this.totalDropped++;
      console.warn(`[MessageQueue] Queue full, dropped oldest message (total dropped: ${this.totalDropped})`);
      if (this.onDrop) {
        try { this.onDrop(dropped.data); } catch { /* don't let callback errors break enqueue */ }
      }
    }

    this.queue.push({
      data: message,
      timestamp: Date.now(),
    });

    // Start processing if not already
    if (!this.isProcessing) {
      this.processNext();
    }
  }

  /**
   * Process the next message in the queue
   */
  private async processNext(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0 || !this.handler) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;

      try {
        await this.handler(item.data);
        this.totalProcessed++;
      } catch (error) {
        this.totalErrors++;
        const err = error instanceof Error ? error : new Error(String(error));

        if (this.errorHandler) {
          this.errorHandler(err, item.data);
        }

        if (this.clearOnError) {
          this.clear();
          break;
        }
      }
    }

    this.isProcessing = false;
  }

  /**
   * Clear all pending messages
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * Get queue statistics
   */
  getStats(): MessageQueueStats {
    return {
      queueSize: this.queue.length,
      isProcessing: this.isProcessing,
      totalProcessed: this.totalProcessed,
      totalErrors: this.totalErrors,
      totalDropped: this.totalDropped,
    };
  }

  /**
   * Get current queue size
   */
  get size(): number {
    return this.queue.length;
  }

  /**
   * Check if currently processing
   */
  get processing(): boolean {
    return this.isProcessing;
  }

  /**
   * Wait for all current messages to be processed
   */
  async drain(): Promise<void> {
    while (this.isProcessing || this.queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.totalProcessed = 0;
    this.totalErrors = 0;
  }
}
