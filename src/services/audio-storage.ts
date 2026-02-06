/**
 * Audio File Storage Service
 *
 * Stores audio files on disk and provides loading utilities.
 * File layout: {appData}/audio/{sessionId}/{chunkId}.wav
 */

import { isTauri } from './recording';
import { createStorageDir, deleteSessionFiles } from './media-storage-base';

const ensureAudioDir = createStorageDir('audio', 'AUDIO STORAGE');

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
 * Delete all audio files for a session
 */
export async function deleteSessionAudio(sessionId: string): Promise<void> {
  return deleteSessionFiles(ensureAudioDir, sessionId, 'AUDIO STORAGE');
}
