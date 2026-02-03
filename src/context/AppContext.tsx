import { createContext, useContext, useReducer, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '../types'
import { storage } from '../services/storage'
import { initDatabase, deleteSessionData } from '../services/database'
import { isTauri } from '../services/recording'

interface AppState {
  sessions: Session[]
  isLoading: boolean
  activeSession: Session | null // For recording
}

type AppAction =
  | { type: 'SET_SESSIONS'; payload: Session[] }
  | { type: 'ADD_SESSION'; payload: Session }
  | { type: 'UPDATE_SESSION'; payload: Session }
  | { type: 'DELETE_SESSION'; payload: string }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'START_RECORDING'; payload: Session }
  | { type: 'STOP_RECORDING' }

const initialState: AppState = {
  sessions: [],
  isLoading: true,
  activeSession: null,
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
          console.error('Database init failed:', err)
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
        const sessions = await storage.loadSessions()
        dispatch({ type: 'SET_SESSIONS', payload: sessions })
      } catch (error) {
        console.error('Failed to load sessions:', error)
        dispatch({ type: 'SET_LOADING', payload: false })
      }
    }
    load()
  }, [dbReady])

  const addSession = async (session: Session) => {
    dispatch({ type: 'ADD_SESSION', payload: session })
    await storage.saveSession(session)
  }

  const updateSession = async (session: Session) => {
    dispatch({ type: 'UPDATE_SESSION', payload: session })
    await storage.saveSession(session)
  }

  const deleteSession = async (id: string) => {
    dispatch({ type: 'DELETE_SESSION', payload: id })

    // Delete from database first (includes all related data)
    try {
      await deleteSessionData(id)
    } catch (err) {
      console.error('Failed to delete session from database:', err)
    }

    // Then delete from localStorage
    await storage.deleteSession(id)
  }

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
    <AppContext.Provider value={{ state, dispatch, addSession, updateSession, deleteSession }}>
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
