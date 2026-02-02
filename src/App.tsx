import { useState, useCallback, useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import { AppProvider, useApp } from './context/AppContext'
import { Home } from './components/Home'
import { SummaryView } from './components/SummaryView'
import { History } from './components/History'
import { QuickCapture } from './components/QuickCapture'
import { SessionRecording } from './components/SessionRecording'
import { CommandPalette } from './components/CommandPalette'
import { Settings } from './components/Settings'
import { ToastProvider } from './components/Toast'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useGlobalShortcuts } from './hooks/useKeyboardShortcuts'
import { generateId } from './utils/id'
import type { Session } from './types'

type View = 'home' | 'summary' | 'history' | 'capture' | 'recording' | 'settings'

function AppContent() {
  const { state, dispatch } = useApp()
  const [view, setView] = useState<View>('home')
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [showCommandPalette, setShowCommandPalette] = useState(false)

  const handleSessionSelect = useCallback((session: Session) => {
    setSelectedSession(session)
    setView('summary')
  }, [])

  const handleBack = useCallback(() => {
    setSelectedSession(null)
    setView('home')
  }, [])

  const handleCaptureComplete = useCallback((session: Session) => {
    setSelectedSession(session)
    setView('summary')
  }, [])

  const handleRecordingComplete = useCallback((session: Session) => {
    setSelectedSession(session)
    setView('summary')
  }, [])

  const handleStartSession = useCallback(() => {
    const session: Session = {
      id: generateId(),
      type: 'session',
      title: 'New Session',
      createdAt: new Date().toISOString(),
    }
    dispatch({ type: 'START_RECORDING', payload: session })
    setView('recording')
    setShowCommandPalette(false)
  }, [dispatch])

  // Keyboard shortcuts
  useGlobalShortcuts({
    onNewCapture: () => {
      if (view !== 'recording') {
        setView('capture')
      }
    },
    onNewSession: () => {
      if (view !== 'recording') {
        handleStartSession()
      }
    },
    onGoHome: () => {
      if (view !== 'recording') {
        handleBack()
      }
    },
    onSearch: () => {
      if (view !== 'recording') {
        setShowCommandPalette(true)
      }
    },
  })

  // If there's an active recording, show that
  useEffect(() => {
    if (state.activeSession && view !== 'recording') {
      setView('recording')
    }
  }, [state.activeSession, view])

  // Listen for navigate-to-settings events (from LiveSessionPanel)
  useEffect(() => {
    const handleNavigateToSettings = () => {
      setView('settings')
    }
    window.addEventListener('navigate-to-settings', handleNavigateToSettings)
    return () => {
      window.removeEventListener('navigate-to-settings', handleNavigateToSettings)
    }
  }, [])

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <AnimatePresence mode="wait">
        {view === 'home' && (
          <Home
            key="home"
            onNavigate={setView}
            onSessionSelect={handleSessionSelect}
          />
        )}
        {view === 'summary' && selectedSession && (
          <SummaryView
            key="summary"
            session={selectedSession}
            onBack={handleBack}
          />
        )}
        {view === 'history' && (
          <History
            key="history"
            onBack={handleBack}
            onSessionSelect={handleSessionSelect}
          />
        )}
        {view === 'capture' && (
          <QuickCapture
            key="capture"
            onBack={handleBack}
            onComplete={handleCaptureComplete}
          />
        )}
        {view === 'recording' && (
          <SessionRecording
            key="recording"
            onComplete={handleRecordingComplete}
            onCancel={handleBack}
          />
        )}
        {view === 'settings' && (
          <Settings
            key="settings"
            onBack={handleBack}
          />
        )}
      </AnimatePresence>

      {/* Command Palette */}
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        sessions={state.sessions}
        onSessionSelect={handleSessionSelect}
        onNewCapture={() => {
          setView('capture')
          setShowCommandPalette(false)
        }}
        onNewSession={handleStartSession}
        onGoToHistory={() => {
          setView('history')
          setShowCommandPalette(false)
        }}
      />
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </AppProvider>
    </ErrorBoundary>
  )
}
