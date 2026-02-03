/**
 * Storage Service
 *
 * Simple localStorage-based storage for session summaries.
 * Uses a write lock to prevent race conditions.
 */

import type { Session } from '../types'
import { getAllCompleteSessions } from './database'

const STORAGE_KEY = 'sessions'

class StorageService {
  // Write lock to prevent concurrent modifications
  private writeLock: Promise<void> = Promise.resolve()

  /**
   * Acquire write lock for safe concurrent access
   */
  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    // Wait for any pending operation to complete
    await this.writeLock

    // Create a new lock for this operation
    let resolve: () => void
    this.writeLock = new Promise(r => { resolve = r })

    try {
      return await operation()
    } finally {
      resolve!()
    }
  }

  async loadSessions(): Promise<Session[]> {
    try {
      const data = localStorage.getItem(STORAGE_KEY)
      if (!data) return []

      const parsed = JSON.parse(data)

      // Validate that we got an array
      if (!Array.isArray(parsed)) {
        console.error('[STORAGE] Invalid data format - expected array')
        return []
      }

      // Basic validation of session objects
      const sessions: Session[] = parsed.filter((s: unknown) => {
        if (typeof s !== 'object' || s === null) return false
        const session = s as Record<string, unknown>
        return (
          typeof session.id === 'string' &&
          typeof session.type === 'string' &&
          typeof session.title === 'string' &&
          typeof session.createdAt === 'string'
        )
      })

      // Sort by createdAt descending
      return sessions.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
    } catch (error) {
      console.error('[STORAGE] Failed to load sessions:', error)
      // Return empty array but log the error for debugging
      // In a production app, we might want to show an error to the user
      return []
    }
  }

  async saveSession(session: Session): Promise<void> {
    return this.withLock(async () => {
      try {
        const sessions = await this.loadSessions()
        const existingIndex = sessions.findIndex(s => s.id === session.id)

        if (existingIndex >= 0) {
          sessions[existingIndex] = session
        } else {
          sessions.unshift(session)
        }

        const data = JSON.stringify(sessions)

        // Check localStorage quota before writing
        // localStorage typically has a 5-10MB limit
        if (data.length > 4 * 1024 * 1024) {
          console.warn('[STORAGE] Data approaching localStorage limit')
        }

        localStorage.setItem(STORAGE_KEY, data)
      } catch (error) {
        console.error('[STORAGE] Failed to save session:', error)
        // Check if it's a quota error
        if (error instanceof DOMException && error.name === 'QuotaExceededError') {
          throw new Error('Storage quota exceeded. Please delete some old sessions.')
        }
        throw error
      }
    })
  }

  async deleteSession(id: string): Promise<void> {
    return this.withLock(async () => {
      try {
        const sessions = await this.loadSessions()
        const filtered = sessions.filter(s => s.id !== id)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
      } catch (error) {
        console.error('[STORAGE] Failed to delete session:', error)
        throw error
      }
    })
  }

  async getSession(id: string): Promise<Session | null> {
    const sessions = await this.loadSessions()
    return sessions.find(s => s.id === id) || null
  }

  /**
   * Get the stored API key for AI services
   */
  getApiKey(): string | null {
    try {
      return localStorage.getItem('sessions_api_key')
    } catch {
      return null
    }
  }

  /**
   * Get storage usage info
   */
  getStorageInfo(): { used: number; available: number } {
    try {
      const data = localStorage.getItem(STORAGE_KEY) || ''
      const used = new Blob([data]).size
      // localStorage typically has 5MB limit, but varies by browser
      const available = 5 * 1024 * 1024 - used
      return { used, available }
    } catch {
      return { used: 0, available: 5 * 1024 * 1024 }
    }
  }

  /**
   * Rebuild localStorage from database
   * Use when localStorage is corrupted or cleared
   */
  async syncFromDatabase(): Promise<Session[]> {
    const dbSessions = await getAllCompleteSessions()

    // Convert DbSession to Session format
    const sessions: Session[] = dbSessions.map(db => ({
      id: db.id,
      type: db.type as 'session' | 'capture',
      title: db.title,
      createdAt: db.created_at,
      duration: db.duration_seconds ?? undefined,
      // Note: summary data is stored separately in rolling_summaries table
      // and would need to be fetched separately if needed
    }))

    // Save to localStorage using the write lock
    return this.withLock(async () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
        console.log(`[STORAGE] Synced ${sessions.length} sessions from database`)
        return sessions
      } catch (error) {
        console.error('[STORAGE] Failed to sync from database:', error)
        throw error
      }
    })
  }

  /**
   * Verify localStorage and database are in sync
   */
  async verifyStorageSync(): Promise<{
    inSync: boolean
    localCount: number
    dbCount: number
  }> {
    const local = await this.loadSessions()
    const dbSessions = await getAllCompleteSessions()

    return {
      inSync: local.length === dbSessions.length,
      localCount: local.length,
      dbCount: dbSessions.length,
    }
  }
}

export const storage = new StorageService()
