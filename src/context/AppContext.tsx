import { createContext, useContext, useReducer, useEffect, useState, useMemo, useCallback, type ReactNode } from 'react'
import type { Session } from '../types'
import { storage } from '../services/storage'
import {
  initDatabase,
  deleteSessionData,
  findOrphanedSessions,
  markSessionsAsInterrupted,
  createSession,
  updateSessionStatus,
  saveSessionSummary,
  saveCapturePayload,
  updateSessionTitle,
  loadAllSessions,
} from '../services/database'
import { isTauri } from '../services/recording'
import { logger } from '../utils/logger'

interface AppState {
  sessions: Session[]
  isLoading: boolean
  activeSession: Session | null // For recording
  error: string | null
  recoveredSessionCount: number
}

type AppAction =
  | { type: 'SET_SESSIONS'; payload: Session[] }
  | { type: 'ADD_SESSION'; payload: Session }
  | { type: 'UPDATE_SESSION'; payload: Session }
  | { type: 'DELETE_SESSION'; payload: string }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'START_RECORDING'; payload: Session }
  | { type: 'STOP_RECORDING' }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_RECOVERED_COUNT'; payload: number }
  | { type: 'DISMISS_RECOVERY' }

const initialState: AppState = {
  sessions: [],
  isLoading: true,
  activeSession: null,
  error: null,
  recoveredSessionCount: 0,
}

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_SESSIONS':
      return { ...state, sessions: action.payload, isLoading: false }
    case 'ADD_SESSION':
      return { ...state, sessions: [action.payload, ...state.sessions] }
    case 'UPDATE_SESSION':
      return {
        ...state,
        sessions: state.sessions.map(s =>
          s.id === action.payload.id ? action.payload : s
        ),
      }
    case 'DELETE_SESSION':
      return {
        ...state,
        sessions: state.sessions.filter(s => s.id !== action.payload),
      }
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload }
    case 'START_RECORDING':
      return { ...state, activeSession: action.payload }
    case 'STOP_RECORDING':
      return { ...state, activeSession: null }
    case 'SET_ERROR':
      return { ...state, error: action.payload }
    case 'SET_RECOVERED_COUNT':
      return { ...state, recoveredSessionCount: action.payload }
    case 'DISMISS_RECOVERY':
      return { ...state, recoveredSessionCount: 0 }
    default:
      return state
  }
}

interface AppContextValue {
  state: AppState
  dispatch: React.Dispatch<AppAction>
  // Convenience methods
  addSession: (session: Session) => Promise<void>
  updateSession: (session: Session) => Promise<void>
  deleteSession: (id: string) => Promise<void>
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState)
  const [dbReady, setDbReady] = useState(false)
  const [dbError, setDbError] = useState<string | null>(null)

  // Initialize database on mount (only in Tauri)
  useEffect(() => {
    if (isTauri()) {
      initDatabase()
        .then(() => setDbReady(true))
        .catch(err => {
          logger.error('Database init failed:', err)
          setDbError(err instanceof Error ? err.message : 'Database initialization failed')
        })
    } else {
      // In browser mode, skip database initialization
      setDbReady(true)
    }
  }, [])

  // Load sessions on mount (after db is ready)
  useEffect(() => {
    if (!dbReady) return

    async function load() {
      try {
        // Crash recovery: mark orphaned sessions as interrupted
        if (isTauri()) {
          try {
            const orphanedSessions = await findOrphanedSessions()
            if (orphanedSessions.length > 0) {
              const sessionIds = orphanedSessions.map(s => s.id)
              await markSessionsAsInterrupted(sessionIds)
              dispatch({ type: 'SET_RECOVERED_COUNT', payload: sessionIds.length })
              logger.info(`[CRASH RECOVERY] Recovered ${sessionIds.length} interrupted sessions`)
            }
          } catch (recoveryError) {
            logger.error('[CRASH RECOVERY] Failed to recover sessions:', recoveryError)
            // Continue loading even if recovery fails
          }
        }

        const sessions = isTauri()
          ? await loadAllSessions()
          : await storage.loadSessions()
        dispatch({ type: 'SET_SESSIONS', payload: sessions })
      } catch (error) {
        logger.error('Failed to load sessions:', error)
        dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Failed to load sessions' })
        dispatch({ type: 'SET_LOADING', payload: false })
      }
    }
    load()
  }, [dbReady])

  const addSession = useCallback(async (session: Session) => {
    dispatch({ type: 'ADD_SESSION', payload: session })
    if (isTauri()) {
      // Persist capture sessions to the database (recording sessions are created at start)
      if (session.type === 'capture') {
        try {
          await createSession(session.id, 'capture', session.title, 'ambient')
          await updateSessionStatus(session.id, 'complete', session.duration)
          if (session.captureText || session.attachments) {
            await saveCapturePayload(session.id, session.captureText || '', session.attachments)
          }
        } catch (error) {
          logger.error('[DATABASE] Failed to persist capture session:', error)
        }
      }

      if (session.summary) {
        try {
          await saveSessionSummary(session.id, session.summary)
        } catch (error) {
          logger.error('[DATABASE] Failed to save session summary:', error)
        }
      }
    } else {
      // Browser dev mode: persist to localStorage
      await storage.saveSession(session)
    }
  }, [dispatch])

  const updateSession = useCallback(async (session: Session) => {
    dispatch({ type: 'UPDATE_SESSION', payload: session })
    if (isTauri()) {
      try {
        await updateSessionTitle(session.id, session.title)
      } catch (error) {
        logger.error('[DATABASE] Failed to update session title:', error)
      }

      if (session.summary) {
        try {
          await saveSessionSummary(session.id, session.summary)
        } catch (error) {
          logger.error('[DATABASE] Failed to update session summary:', error)
        }
      }

      if (session.type === 'capture' && (session.captureText || session.attachments)) {
        try {
          await saveCapturePayload(session.id, session.captureText || '', session.attachments)
        } catch (error) {
          logger.error('[DATABASE] Failed to update capture payload:', error)
        }
      }
    } else {
      // Browser dev mode: persist to localStorage
      await storage.saveSession(session)
    }
  }, [dispatch])

  const deleteSession = useCallback(async (id: string) => {
    if (isTauri()) {
      // SQLite is the primary store
      await deleteSessionData(id)
    } else {
      // Browser dev mode: localStorage fallback
      await storage.deleteSession(id)
    }

    dispatch({ type: 'DELETE_SESSION', payload: id })
  }, [dispatch])

  const contextValue = useMemo(() => ({
    state, dispatch, addSession, updateSession, deleteSession
  }), [state, dispatch, addSession, updateSession, deleteSession])

  if (dbError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-950 p-8">
        <div className="text-center max-w-md">
          <div className="text-red-400 text-lg mb-4">Database Error</div>
          <div className="text-neutral-400 text-sm mb-6">{dbError}</div>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-neutral-800 text-neutral-200 rounded-lg hover:bg-neutral-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!dbReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-950">
        <div className="text-neutral-400">Loading...</div>
      </div>
    )
  }

  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useApp must be used within AppProvider')
  }
  return context
}
