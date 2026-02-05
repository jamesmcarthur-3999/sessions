/**
 * Baleybots Configuration
 *
 * Manages API key configuration for all bots.
 * Uses dynamic imports to avoid loading Node.js-only code at startup.
 */

import { getSecureItem, setSecureItem, removeSecureItem } from '../secure-storage'
import { isTauri } from '../recording'
import { createTauriFetch } from '../tauri-fetch'
import { resetPipelines } from './pipelines'
import { logger } from '../../utils/logger'

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

    // Configure baleybots to use Tauri's HTTP proxy when in Tauri environment
    // This bypasses browser CORS restrictions by routing through Rust
    if (isTauri()) {
      const tauriFetch = createTauriFetch();
      baleybots.Baleybot.setGlobalConfig({
        // Use Tauri fetch for all providers
        fetch: tauriFetch,
        anthropic: {
          fetch: tauriFetch,
        },
        openai: {
          fetch: tauriFetch,
        },
      });
      logger.info('[Baleybots] Configured to use Tauri HTTP proxy');
    } else {
      // In browser mode, use direct fetch with CORS header
      baleybots.Baleybot.setGlobalConfig({
        anthropic: {
          headers: {
            'anthropic-dangerous-direct-browser-access': 'true',
          },
        },
      });
      logger.info('[Baleybots] Configured for direct browser access');
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

    // Get API keys from secure storage only
    const claudeKey = await getSecureItem('sessions_api_key');
    const openaiKey = await getSecureItem('sessions_openai_api_key');

    let hasAnyKey = false;

    if (claudeKey) {
      setDefaultApiKey('anthropic', claudeKey);
      hasAnyKey = true;
      logger.info('[Baleybots] AI service configured');
    } else {
      logger.warn('[Baleybots] No Claude API key found');
    }

    if (openaiKey) {
      setDefaultApiKey('openai', openaiKey);
      logger.info('[Baleybots] Transcription service configured');
    }

    isInitialized = hasAnyKey;

    if (!hasAnyKey) {
      logger.warn('[Baleybots] No API keys configured - AI features will not work');
    }

    return hasAnyKey;
  } catch (error) {
    logger.error('[Baleybots] Failed to initialize:', error);
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
        logger.info('[Baleybots] AI service updated');
      } else {
        await removeSecureItem('sessions_api_key');
        keysRemoved = true;
        logger.info('[Baleybots] AI service removed');
      }
    }

    if (config.openaiApiKey !== undefined) {
      if (config.openaiApiKey) {
        setDefaultApiKey('openai', config.openaiApiKey);
        await setSecureItem('sessions_openai_api_key', config.openaiApiKey);
        logger.info('[Baleybots] Transcription service updated');
      } else {
        await removeSecureItem('sessions_openai_api_key');
        keysRemoved = true;
        logger.info('[Baleybots] Transcription service removed');
      }
    }

    // Reset bot state if keys were removed to force re-initialization
    if (keysRemoved) {
      resetBots();
    }

    // Mark as initialized if we have at least Claude key
    isInitialized = !!(await getSecureItem('sessions_api_key'));
  } catch (error) {
    logger.error('[Baleybots] Failed to update API keys:', error);
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
 * Also resets cached pipelines to pick up new configuration
 */
export function resetBots(): void {
  isInitialized = false;
  // Reset cached pipelines so they pick up new configuration
  resetPipelines();
}

/**
 * Test API key by making a lightweight API call
 * Returns true if the key is valid, false otherwise
 */
export async function testApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    // Use Tauri fetch when available, otherwise native fetch with CORS header
    const fetchFn = isTauri() ? createTauriFetch() : fetch;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };

    // Add CORS header for browser mode
    if (!isTauri()) {
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    }

    const response = await fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022', // Use cheapest model for test
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
