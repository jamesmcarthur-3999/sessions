/**
 * Baleybots Configuration
 *
 * Manages API key configuration for all bots.
 * Uses dynamic imports to avoid loading Node.js-only code at startup.
 */

export interface BotConfig {
  claudeApiKey?: string;
  openaiApiKey?: string;
}

let isInitialized = false;
let baleybots: typeof import('@baleybots/core') | null = null;

/**
 * Dynamically load @baleybots/core to avoid loading Node.js-only code at startup
 */
async function loadBaleybots() {
  if (!baleybots) {
    baleybots = await import('@baleybots/core');
  }
  return baleybots;
}

/**
 * Initialize Baleybots with API keys from localStorage
 */
export async function initializeBots(): Promise<boolean> {
  if (isInitialized) return true;

  try {
    const { setDefaultApiKey } = await loadBaleybots();

    // Get Claude API key from localStorage
    const claudeKey = localStorage.getItem('sessions_api_key');

    // Get OpenAI API key from localStorage (for Whisper)
    const openaiKey = localStorage.getItem('sessions_openai_api_key');

    let hasAnyKey = false;

    if (claudeKey) {
      setDefaultApiKey('anthropic', claudeKey);
      hasAnyKey = true;
      console.log('[Baleybots] Anthropic API key configured');
    }

    if (openaiKey) {
      setDefaultApiKey('openai', openaiKey);
      console.log('[Baleybots] OpenAI API key configured');
    }

    isInitialized = hasAnyKey;

    if (!hasAnyKey) {
      console.warn('[Baleybots] No API keys configured - AI features will not work');
    }

    return hasAnyKey;
  } catch (error) {
    console.error('[Baleybots] Failed to initialize:', error);
    return false;
  }
}

/**
 * Update API keys at runtime (called from settings)
 */
export async function updateApiKeys(config: BotConfig): Promise<void> {
  try {
    const { setDefaultApiKey } = await loadBaleybots();

    if (config.claudeApiKey !== undefined) {
      if (config.claudeApiKey) {
        setDefaultApiKey('anthropic', config.claudeApiKey);
        localStorage.setItem('sessions_api_key', config.claudeApiKey);
        console.log('[Baleybots] Anthropic API key updated');
      } else {
        localStorage.removeItem('sessions_api_key');
        console.log('[Baleybots] Anthropic API key removed');
      }
    }

    if (config.openaiApiKey !== undefined) {
      if (config.openaiApiKey) {
        setDefaultApiKey('openai', config.openaiApiKey);
        localStorage.setItem('sessions_openai_api_key', config.openaiApiKey);
        console.log('[Baleybots] OpenAI API key updated');
      } else {
        localStorage.removeItem('sessions_openai_api_key');
        console.log('[Baleybots] OpenAI API key removed');
      }
    }

    // Mark as initialized if we have at least Claude key
    isInitialized = !!localStorage.getItem('sessions_api_key');
  } catch (error) {
    console.error('[Baleybots] Failed to update API keys:', error);
    throw error;
  }
}

/**
 * Check if bots are ready to use
 */
export function isBotsReady(): boolean {
  return isInitialized;
}

/**
 * Check if bots have API key without initializing
 */
export function hasApiKey(): boolean {
  return !!localStorage.getItem('sessions_api_key');
}

/**
 * Reset initialization state (for testing or key changes)
 */
export function resetBots(): void {
  isInitialized = false;
}
