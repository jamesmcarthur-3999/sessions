/**
 * Baleybots Configuration
 *
 * Manages API key configuration for all bots.
 * Uses dynamic imports to avoid loading Node.js-only code at startup.
 */

import { getSecureItem, setSecureItem, removeSecureItem } from '../secure-storage'
import { isTauri } from '../recording'

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
    try {
      baleybots.Baleybot.setGlobalConfig({
        anthropic: {
          headers: {
            'anthropic-dangerous-direct-browser-access': 'true',
          },
        },
      });
    } catch (error) {
      console.warn('[Baleybots] Failed to set global config:', error);
    }
  }
  return baleybots;
}

/**
 * Initialize Baleybots with API keys from secure storage
 */
export async function initializeBots(): Promise<boolean> {
  // Always try to load and set keys - don't skip even if initialized
  // This ensures keys are re-applied after module reloads
  try {
    const { setDefaultApiKey } = await loadBaleybots();

    // Get Claude API key - try secure storage first, then localStorage fallback
    let claudeKey = await getSecureItem('sessions_api_key');

    // Fallback to localStorage if secure storage returns null (browser mode or migration issue)
    if (!claudeKey && !isTauri()) {
      claudeKey = localStorage.getItem('sessions_api_key');
    }

    // Get OpenAI API key from secure storage (for Whisper)
    let openaiKey = await getSecureItem('sessions_openai_api_key');
    if (!openaiKey && !isTauri()) {
      openaiKey = localStorage.getItem('sessions_openai_api_key');
    }

    let hasAnyKey = false;

    if (claudeKey) {
      setDefaultApiKey('anthropic', claudeKey);
      hasAnyKey = true;
      console.log('[Baleybots] AI service configured with key:', claudeKey.substring(0, 10) + '...');
    } else {
      console.warn('[Baleybots] No Claude API key found');
    }

    if (openaiKey) {
      setDefaultApiKey('openai', openaiKey);
      console.log('[Baleybots] Transcription service configured');
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

    let keysRemoved = false;

    if (config.claudeApiKey !== undefined) {
      if (config.claudeApiKey) {
        setDefaultApiKey('anthropic', config.claudeApiKey);
        await setSecureItem('sessions_api_key', config.claudeApiKey);
        console.log('[Baleybots] AI service updated');
      } else {
        await removeSecureItem('sessions_api_key');
        keysRemoved = true;
        console.log('[Baleybots] AI service removed');
      }
    }

    if (config.openaiApiKey !== undefined) {
      if (config.openaiApiKey) {
        setDefaultApiKey('openai', config.openaiApiKey);
        await setSecureItem('sessions_openai_api_key', config.openaiApiKey);
        console.log('[Baleybots] Transcription service updated');
      } else {
        await removeSecureItem('sessions_openai_api_key');
        keysRemoved = true;
        console.log('[Baleybots] Transcription service removed');
      }
    }

    // Reset bot state if keys were removed to force re-initialization
    if (keysRemoved) {
      resetBots();
    }

    // Mark as initialized if we have at least Claude key
    isInitialized = !!(await getSecureItem('sessions_api_key'));
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
export async function hasApiKey(): Promise<boolean> {
  return !!(await getSecureItem('sessions_api_key'));
}

/**
 * Reset initialization state (for testing or key changes)
 */
export function resetBots(): void {
  isInitialized = false;
}

/**
 * Test API key by making a lightweight API call
 * Returns true if the key is valid, false otherwise
 */
export async function testApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    // Make a minimal API call to verify the key works
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307', // Use cheapest model for test
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }],
      }),
    });

    if (response.ok) {
      return { valid: true };
    }

    const errorData = await response.json().catch(() => ({}));
    const errorMessage = errorData?.error?.message || `API returned ${response.status}`;

    // Check for specific error types
    if (response.status === 401) {
      return { valid: false, error: 'Invalid API key' };
    }
    if (response.status === 403) {
      return { valid: false, error: 'API key does not have permission' };
    }
    if (response.status === 429) {
      // Rate limited but key is valid
      return { valid: true };
    }

    return { valid: false, error: errorMessage };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error';
    return { valid: false, error: message };
  }
}
