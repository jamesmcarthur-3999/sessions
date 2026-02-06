/**
 * Screenshot File Storage Service
 *
 * Stores screenshot images as files on disk instead of in SQLite.
 * This prevents 5+ second database writes and app crashes.
 *
 * File layout: {appData}/screenshots/{sessionId}/{screenshotId}.jpg
 */

import { isTauri } from './recording';
import { createStorageDir, deleteSessionFiles } from './media-storage-base';

const ensureScreenshotDir = createStorageDir('screenshots', 'SCREENSHOT STORAGE');

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
  return deleteSessionFiles(ensureScreenshotDir, sessionId, 'SCREENSHOT STORAGE');
}
