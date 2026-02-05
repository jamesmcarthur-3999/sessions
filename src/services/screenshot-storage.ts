/**
 * Screenshot File Storage Service
 *
 * Stores screenshot images as files on disk instead of in SQLite.
 * This prevents 5+ second database writes and app crashes.
 *
 * File layout: {appData}/screenshots/{sessionId}/{screenshotId}.jpg
 */

import { isTauri } from './recording';
import { logger } from '../utils/logger';

// Storage paths
let appDataDir: string | null = null;
let screenshotsDir: string | null = null;

/**
 * Initialize screenshot storage directories
 */
async function ensureStorageDir(): Promise<string> {
  if (screenshotsDir) return screenshotsDir;

  if (!isTauri()) {
    throw new Error('Screenshot storage requires Tauri environment');
  }

  const { appDataDir: getAppDataDir, join } = await import('@tauri-apps/api/path');
  const { mkdir, exists } = await import('@tauri-apps/plugin-fs');

  appDataDir = await getAppDataDir();
  screenshotsDir = await join(appDataDir, 'screenshots');

  // Create screenshots directory if it doesn't exist
  if (!(await exists(screenshotsDir))) {
    await mkdir(screenshotsDir, { recursive: true });
    logger.debug('[SCREENSHOT STORAGE] Created directory:', screenshotsDir);
  }

  return screenshotsDir;
}

/**
 * Get or create session screenshot directory
 */
async function ensureSessionDir(sessionId: string): Promise<string> {
  const baseDir = await ensureStorageDir();
  const { join } = await import('@tauri-apps/api/path');
  const sessionDir = await join(baseDir, sessionId);

  const { mkdir, exists } = await import('@tauri-apps/plugin-fs');
  if (!(await exists(sessionDir))) {
    await mkdir(sessionDir, { recursive: true });
  }

  return sessionDir;
}

/**
 * Save screenshot to file and return the file path
 * This is a non-blocking operation that won't freeze the UI
 */
export async function saveScreenshotToFile(
  sessionId: string,
  screenshotId: string,
  dataBase64: string
): Promise<string> {
  if (!isTauri()) {
    throw new Error('Screenshot storage requires Tauri environment');
  }

  const sessionDir = await ensureSessionDir(sessionId);
  const { join } = await import('@tauri-apps/api/path');

  // Determine file extension from data URL
  const isJpeg = dataBase64.includes('data:image/jpeg') || dataBase64.includes('image/jpeg');
  const ext = isJpeg ? 'jpg' : 'png';
  const filePath = await join(sessionDir, `${screenshotId}.${ext}`);

  // Strip the data URL prefix to get raw base64
  const base64Data = dataBase64.replace(/^data:image\/\w+;base64,/, '');

  // Decode base64 to binary using fetch (async, doesn't block main thread)
  const response = await fetch(`data:application/octet-stream;base64,${base64Data}`);
  const bytes = new Uint8Array(await response.arrayBuffer());

  // Write to file using Tauri fs plugin
  const { writeFile } = await import('@tauri-apps/plugin-fs');
  await writeFile(filePath, bytes);

  logger.debug(`[SCREENSHOT STORAGE] Saved: ${filePath} (${Math.round(bytes.length / 1024)}KB)`);
  return filePath;
}

/**
 * Load screenshot from file path and return as base64 data URL
 */
export async function loadScreenshotData(filePath: string): Promise<string> {
  if (!isTauri()) {
    throw new Error('Screenshot loading requires Tauri environment');
  }

  const { readFile } = await import('@tauri-apps/plugin-fs');
  const bytes = await readFile(filePath);

  // Convert to base64 using Blob + FileReader (async, handles large files)
  const isJpeg = filePath.endsWith('.jpg') || filePath.endsWith('.jpeg');
  const mimeType = isJpeg ? 'image/jpeg' : 'image/png';
  const blob = new Blob([bytes], { type: mimeType });

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Load screenshot as binary ArrayBuffer for efficient worker transfer
 */
export async function loadScreenshotBinary(filePath: string): Promise<ArrayBuffer> {
  if (!isTauri()) {
    throw new Error('Screenshot loading requires Tauri environment');
  }

  const { readFile } = await import('@tauri-apps/plugin-fs');
  const bytes = await readFile(filePath);

  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/**
 * Delete all screenshots for a session
 */
export async function deleteSessionScreenshots(sessionId: string): Promise<void> {
  if (!isTauri()) return;

  try {
    const baseDir = await ensureStorageDir();
    const { join } = await import('@tauri-apps/api/path');
    const sessionDir = await join(baseDir, sessionId);

    const { remove, exists } = await import('@tauri-apps/plugin-fs');
    if (await exists(sessionDir)) {
      await remove(sessionDir, { recursive: true });
      logger.debug('[SCREENSHOT STORAGE] Deleted session directory:', sessionDir);
    }
  } catch (error) {
    logger.error('[SCREENSHOT STORAGE] Failed to delete session screenshots:', error);
  }
}

/**
 * Get total size of stored screenshots (for debugging/monitoring)
 */
export async function getStorageStats(): Promise<{
  totalSessions: number;
  totalFiles: number;
  totalSizeBytes: number;
}> {
  if (!isTauri()) {
    return { totalSessions: 0, totalFiles: 0, totalSizeBytes: 0 };
  }

  try {
    const baseDir = await ensureStorageDir();
    const { join } = await import('@tauri-apps/api/path');
    const { readDir, stat } = await import('@tauri-apps/plugin-fs');

    const sessions = await readDir(baseDir);
    let totalFiles = 0;
    let totalSizeBytes = 0;

    for (const session of sessions) {
      if (session.isDirectory && session.name) {
        try {
          const sessionDir = await join(baseDir, session.name);
          const files = await readDir(sessionDir);
          for (const file of files) {
            if (file.isFile && file.name) {
              totalFiles++;
              try {
                const filePath = await join(sessionDir, file.name);
                const fileStat = await stat(filePath);
                totalSizeBytes += fileStat.size;
              } catch {
                // Ignore stat errors
              }
            }
          }
        } catch {
          // Ignore errors reading session directories
        }
      }
    }

    return {
      totalSessions: sessions.filter(s => s.isDirectory).length,
      totalFiles,
      totalSizeBytes,
    };
  } catch (error) {
    logger.error('[SCREENSHOT STORAGE] Failed to get stats:', error);
    return { totalSessions: 0, totalFiles: 0, totalSizeBytes: 0 };
  }
}
