/**
 * Secure Storage Service
 * Uses Tauri's plugin-store for encrypted storage in Tauri context,
 * falls back to localStorage with warning in browser context.
 */

import { isTauri } from './recording'

let store: any = null

async function getStore() {
  if (!isTauri()) {
    console.warn('[SECURE-STORAGE] Not in Tauri context, using localStorage (insecure)')
    return null
  }

  if (!store) {
    const { Store } = await import('@tauri-apps/plugin-store')
    store = new Store('secure-credentials.json')
  }
  return store
}

export async function setSecureItem(key: string, value: string): Promise<void> {
  const s = await getStore()
  if (s) {
    await s.set(key, value)
    await s.save()
  } else {
    localStorage.setItem(key, value)
  }
}

export async function getSecureItem(key: string): Promise<string | null> {
  const s = await getStore()
  if (s) {
    return await s.get(key) as string | null
  } else {
    return localStorage.getItem(key)
  }
}

export async function removeSecureItem(key: string): Promise<void> {
  const s = await getStore()
  if (s) {
    await s.delete(key)
    await s.save()
  } else {
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
