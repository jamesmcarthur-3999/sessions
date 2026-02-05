/**
 * Secure Storage Service
 * Uses Tauri's plugin-store for encrypted storage in Tauri context,
 * falls back to localStorage with warning in browser context.
 */

import { isTauri } from './recording'

/** Keys that contain secrets and must not be stored in plaintext localStorage */
const SECRET_KEYS = new Set(['sessions_api_key', 'sessions_openai_api_key'])

let store: any = null

async function getStore() {
  if (!isTauri()) {
    return null
  }

  if (!store) {
    console.log('[SECURE-STORAGE] Loading store...')
    const { load } = await import('@tauri-apps/plugin-store')
    store = await load('secure-credentials.json')
    console.log('[SECURE-STORAGE] Store loaded successfully')
  }
  return store
}

/** Check whether secure (Tauri) storage is available */
export function isSecureStorageAvailable(): boolean {
  return isTauri()
}

export async function setSecureItem(key: string, value: string): Promise<void> {
  const s = await getStore()
  if (s) {
    await s.set(key, value)
    await s.save()
  } else if (SECRET_KEYS.has(key)) {
    throw new Error(
      'Secure storage unavailable outside the desktop app. API keys cannot be stored safely in the browser.'
    )
  } else {
    localStorage.setItem(key, value)
  }
}

export async function getSecureItem(key: string): Promise<string | null> {
  const s = await getStore()
  if (s) {
    const value = await s.get(key) as string | null
    console.log(`[SECURE-STORAGE] Get '${key}': ${value ? 'found' : 'not found'}`)
    return value
  } else if (SECRET_KEYS.has(key)) {
    // Don't read secrets from insecure localStorage
    return null
  } else {
    return localStorage.getItem(key)
  }
}

export async function removeSecureItem(key: string): Promise<void> {
  const s = await getStore()
  if (s) {
    await s.delete(key)
    await s.save()
  } else if (!SECRET_KEYS.has(key)) {
    localStorage.removeItem(key)
  }
}

export async function migrateToSecureStorage(): Promise<void> {
  if (!isTauri()) return

  const keysToMigrate = ['sessions_api_key', 'sessions_openai_api_key']

  for (const key of keysToMigrate) {
    const value = localStorage.getItem(key)
    if (value) {
      await setSecureItem(key, value)
      localStorage.removeItem(key)
      console.log(`[SECURE-STORAGE] Migrated ${key} to secure storage`)
    }
  }
}
