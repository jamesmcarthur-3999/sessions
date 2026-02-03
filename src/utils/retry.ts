/**
 * Retry Utility
 *
 * Provides exponential backoff retry logic for API calls.
 * Handles rate limits and transient failures gracefully.
 */

export interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors?: string[];
}

const defaultOptions: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  retryableErrors: ['rate_limit', 'overloaded', 'timeout', 'ECONNRESET', '529', '503'],
};

/**
 * Check if an error is retryable
 */
function isRetryableError(error: unknown, retryableErrors: string[]): boolean {
  if (!error) return false;

  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorLower = errorMessage.toLowerCase();

  return retryableErrors.some(keyword =>
    errorLower.includes(keyword.toLowerCase())
  );
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic and exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...defaultOptions, ...options };
  let lastError: unknown;
  let delay = opts.initialDelayMs;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry on last attempt
      if (attempt === opts.maxRetries) {
        break;
      }

      // Check if error is retryable
      if (!isRetryableError(error, opts.retryableErrors!)) {
        console.log('[RETRY] Non-retryable error, failing immediately:', error);
        break;
      }

      console.log(`[RETRY] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await sleep(delay);

      // Increase delay with exponential backoff (with jitter)
      const jitter = Math.random() * 0.3 + 0.85; // 0.85-1.15
      delay = Math.min(delay * opts.backoffMultiplier * jitter, opts.maxDelayMs);
    }
  }

  throw lastError;
}

/**
 * Wrapper specifically for bot.process() calls
 * Uses conservative retry settings appropriate for AI API calls
 */
export async function withBotRetry<T>(fn: () => Promise<T>): Promise<T> {
  return withRetry(fn, {
    maxRetries: 2,
    initialDelayMs: 2000,
    maxDelayMs: 8000,
    backoffMultiplier: 2,
  });
}
