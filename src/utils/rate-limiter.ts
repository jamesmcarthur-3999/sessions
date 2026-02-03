/**
 * Token Bucket Rate Limiter
 *
 * Prevents exceeding API rate limits by tracking requests
 * and waiting when necessary.
 */

export class RateLimiter {
  private tokens: number
  private lastRefill: number
  private readonly maxTokens: number
  private readonly refillRate: number // tokens per millisecond

  constructor(maxRequestsPerMinute: number = 50) {
    this.maxTokens = maxRequestsPerMinute
    this.tokens = maxRequestsPerMinute
    this.lastRefill = Date.now()
    this.refillRate = maxRequestsPerMinute / 60000 // Convert to per-ms
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate)
    this.lastRefill = now
  }

  async acquire(): Promise<void> {
    this.refill()

    if (this.tokens >= 1) {
      this.tokens -= 1
      return
    }

    // Calculate wait time for 1 token
    const waitTime = Math.ceil((1 - this.tokens) / this.refillRate)
    console.log(`[RATE_LIMITER] Waiting ${waitTime}ms for rate limit`)

    await new Promise(resolve => setTimeout(resolve, waitTime))
    this.tokens = 0
  }

  /**
   * Check if we can make a request without waiting
   */
  canProceed(): boolean {
    this.refill()
    return this.tokens >= 1
  }

  /**
   * Get current token count (for monitoring)
   */
  getAvailableTokens(): number {
    this.refill()
    return Math.floor(this.tokens)
  }
}

// Global rate limiter for Claude API (50 RPM default)
export const claudeRateLimiter = new RateLimiter(50)

// Global rate limiter for OpenAI API (60 RPM default)
export const openaiRateLimiter = new RateLimiter(60)
