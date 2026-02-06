/**
 * Shared media storage utilities for audio and screenshot storage.
 *
 * Both audio-storage.ts and screenshot-storage.ts use identical patterns
 * for directory initialization and session cleanup.
 */

import { isTauri } from './recording';
import { logger } from '../utils/logger';

/**
 * Create a storage directory initializer for a given subdirectory name.
 * Returns a function that lazily creates and caches the directory path.
 */
export function createStorageDir(subdirectory: string, label: string): () => Promise<string> {
  let cachedDir: string | null = null;

  return async function ensureDir(): Promise<string> {
    if (cachedDir) return cachedDir;

    if (!isTauri()) {
      throw new Error(`${label} storage requires Tauri environment`);
    }

    const { appDataDir: getAppDataDir, join } = await import('@tauri-apps/api/path');
    const { mkdir, exists } = await import('@tauri-apps/plugin-fs');

    const appData = await getAppDataDir();
    cachedDir = await join(appData, subdirectory);

    if (!(await exists(cachedDir))) {
      await mkdir(cachedDir, { recursive: true });
      logger.debug(`[${label}] Created directory:`, cachedDir);
    }

    return cachedDir;
  };
}

/**
 * Delete all files for a session within a storage directory.
 */
export async function deleteSessionFiles(
  ensureDir: () => Promise<string>,
  sessionId: string,
  label: string,
): Promise<void> {
  if (!isTauri()) return;

  try {
    const baseDir = await ensureDir();
    const { join } = await import('@tauri-apps/api/path');
    const sessionDir = await join(baseDir, sessionId);

    const { remove, exists } = await import('@tauri-apps/plugin-fs');
    if (await exists(sessionDir)) {
      await remove(sessionDir, { recursive: true });
      logger.debug(`[${label}] Deleted session directory:`, sessionDir);
    }
  } catch (error) {
    logger.error(`[${label}] Failed to delete session files:`, error);
  }
}
