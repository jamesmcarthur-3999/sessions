/**
 * Storage Service
 *
 * Simple localStorage-based storage for now.
 * Can be upgraded to IndexedDB or Tauri filesystem later.
 */

import type { Session } from '../types'

const STORAGE_KEY = 'sessions'

class StorageService {
  async loadSessions(): Promise<Session[]> {
    try {
      const data = localStorage.getItem(STORAGE_KEY)
      if (!data) return []

      const sessions: Session[] = JSON.parse(data)
      // Sort by createdAt descending
      return sessions.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
    } catch (error) {
      console.error('Failed to load sessions:', error)
      return []
    }
  }

  async saveSession(session: Session): Promise<void> {
    try {
      const sessions = await this.loadSessions()
      const existingIndex = sessions.findIndex(s => s.id === session.id)

      if (existingIndex >= 0) {
        sessions[existingIndex] = session
      } else {
        sessions.unshift(session)
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
    } catch (error) {
      console.error('Failed to save session:', error)
      throw error
    }
  }

  async deleteSession(id: string): Promise<void> {
    try {
      const sessions = await this.loadSessions()
      const filtered = sessions.filter(s => s.id !== id)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
    } catch (error) {
      console.error('Failed to delete session:', error)
      throw error
    }
  }

  async getSession(id: string): Promise<Session | null> {
    const sessions = await this.loadSessions()
    return sessions.find(s => s.id === id) || null
  }
}

export const storage = new StorageService()
