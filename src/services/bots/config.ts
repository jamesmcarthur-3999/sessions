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
import { aiWorker } from '../worker/ai-worker-client'
import { logger } from '../../utils/logger'

export interface BotConfig {
  claudeApiKey?: string;
  openaiApiKey?: string;
}

let baleybots: typeof import('@baleybots/core') | null = null;

/**
 * Dynamically load @baleybots/core to avoid loading Node.js-only code at startup
 */
async function loadBaleybots(): Promise<typeof import('@baleybots/core')> {
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

    // Reset cached pipelines if keys were removed
    if (keysRemoved) {
      resetPipelines();
    }

    // Propagate keys to the worker if it's running
    if (aiWorker.isReady()) {
      const currentAnthropicKey = await getSecureItem('sessions_api_key');
      const currentOpenaiKey = await getSecureItem('sessions_openai_api_key');
      const workerUpdated = await aiWorker.updateApiKeys(
        currentAnthropicKey || '',
        currentOpenaiKey || null,
      );
      if (workerUpdated) {
        logger.info('[Baleybots] Worker API keys updated');
      } else {
        logger.warn('[Baleybots] Failed to update worker API keys');
      }
    }
  } catch (error) {
    logger.error('[Baleybots] Failed to update API keys:', error);
    throw error;
  }
}

/**
 * Check if bots have API key without initializing
 */
export async function hasApiKey(): Promise<boolean> {
  return !!(await getSecureItem('sessions_api_key'));
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
        model: 'claude-haiku-4-5-20251001', // Use cheapest model for test
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
