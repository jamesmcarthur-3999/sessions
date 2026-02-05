/**
 * Audio File Storage Service
 *
 * Stores audio files on disk and provides loading utilities.
 * File layout: {appData}/audio/{sessionId}/{chunkId}.wav
 */

import { isTauri } from './recording';

// Storage paths (cached)
let appDataDir: string | null = null;
let audioBaseDir: string | null = null;

/**
 * Initialize audio storage directories
 */
async function ensureStorageDir(): Promise<string> {
  if (audioBaseDir) return audioBaseDir;

  if (!isTauri()) {
    throw new Error('Audio storage requires Tauri environment');
  }

  const { appDataDir: getAppDataDir, join } = await import('@tauri-apps/api/path');
  const { mkdir, exists } = await import('@tauri-apps/plugin-fs');

  appDataDir = await getAppDataDir();
  audioBaseDir = await join(appDataDir, 'audio');

  // Create audio directory if it doesn't exist
  if (!(await exists(audioBaseDir))) {
    await mkdir(audioBaseDir, { recursive: true });
    console.log('[AUDIO STORAGE] Created directory:', audioBaseDir);
  }

  return audioBaseDir;
}

/**
 * Get audio directory for a session
 */
export async function getAudioDirectory(sessionId: string): Promise<string> {
  const baseDir = await ensureStorageDir();
  const { join } = await import('@tauri-apps/api/path');
  return join(baseDir, sessionId);
}

/**
 * Load audio binary data from file path
 * Returns ArrayBuffer for efficient worker transfer
 */
export async function loadAudioBinary(filePath: string): Promise<ArrayBuffer> {
  if (!isTauri()) {
    throw new Error('Audio loading requires Tauri environment');
  }

  const { readFile } = await import('@tauri-apps/plugin-fs');
  const bytes = await readFile(filePath);

  // Convert Uint8Array to ArrayBuffer
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/**
 * Load audio as base64 data URL (for backward compatibility)
 */
export async function loadAudioAsBase64(filePath: string): Promise<string> {
  if (!isTauri()) {
    throw new Error('Audio loading requires Tauri environment');
  }

  const { readFile } = await import('@tauri-apps/plugin-fs');
  const bytes = await readFile(filePath);

  // Convert to base64 using Blob + FileReader
  const blob = new Blob([bytes], { type: 'audio/wav' });

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Delete all audio files for a session
 */
export async function deleteSessionAudio(sessionId: string): Promise<void> {
  if (!isTauri()) return;

  try {
    const baseDir = await ensureStorageDir();
    const { join } = await import('@tauri-apps/api/path');
    const sessionDir = await join(baseDir, sessionId);

    const { remove, exists } = await import('@tauri-apps/plugin-fs');
    if (await exists(sessionDir)) {
      await remove(sessionDir, { recursive: true });
      console.log('[AUDIO STORAGE] Deleted session directory:', sessionDir);
    }
  } catch (error) {
    console.error('[AUDIO STORAGE] Failed to delete session audio:', error);
  }
}

/**
 * Check if a path is an audio file path
 */
export function isAudioFilePath(pathOrBase64: string): boolean {
  return !pathOrBase64.startsWith('data:') && pathOrBase64.endsWith('.wav');
}

/**
 * Get storage stats for debugging
 */
export async function getAudioStorageStats(): Promise<{
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
            if (file.isFile && file.name?.endsWith('.wav')) {
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
    console.error('[AUDIO STORAGE] Failed to get stats:', error);
    return { totalSessions: 0, totalFiles: 0, totalSizeBytes: 0 };
  }
}
