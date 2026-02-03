/**
 * Storage Service
 *
 * Simple localStorage-based storage for session summaries.
 * Uses a write lock to prevent race conditions.
 */

import type { Session } from '../types'

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
}

export const storage = new StorageService()
