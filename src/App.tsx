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
import { WelcomeModal } from './components/WelcomeModal'
import { ToastProvider } from './components/Toast'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useGlobalShortcuts } from './hooks/useKeyboardShortcuts'
import { generateId } from './utils/id'
import { migrateToSecureStorage } from './services/secure-storage'
import { sessionRecorder } from './services/recording'
import { sessionBridge } from './services/session-bridge'
import type { Session } from './types'

type View = 'home' | 'summary' | 'history' | 'capture' | 'recording' | 'settings'

function AppContent() {
  const { state, dispatch } = useApp()
  const [view, setView] = useState<View>('home')
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showSettingsOverlay, setShowSettingsOverlay] = useState(false)
  const [showWelcome, setShowWelcome] = useState(() => {
    return !localStorage.getItem('sessions_onboarding_complete')
  })

  const handleSessionSelect = useCallback((session: Session) => {
    setSelectedSession(session)
    setView('summary')
  }, [])

  const handleBack = useCallback(() => {
    setSelectedSession(null)
    setView('home')
    setShowSettingsOverlay(false)
  }, [])

  const handleCaptureComplete = useCallback((session: Session) => {
    setSelectedSession(session)
    setView('summary')
    setShowSettingsOverlay(false)
  }, [])

  const handleRecordingComplete = useCallback((session: Session) => {
    setSelectedSession(session)
    setView('summary')
    setShowSettingsOverlay(false)
  }, [])

  const handleStartSession = useCallback(() => {
    const session: Session = {
      id: generateId(),
      type: 'session',
      title: 'New Session',
      createdAt: new Date().toISOString(),
      status: 'recording',
    }
    dispatch({ type: 'START_RECORDING', payload: session })
    setView('recording')
    setShowCommandPalette(false)
  }, [dispatch])

  const handleWelcomeAddApiKey = useCallback(() => {
    localStorage.setItem('sessions_onboarding_complete', 'true')
    setShowWelcome(false)
    setView('settings')
  }, [])

  const handleWelcomeGetStarted = useCallback(() => {
    localStorage.setItem('sessions_onboarding_complete', 'true')
    setShowWelcome(false)
  }, [])

  // Keyboard shortcuts - disabled during modals and recording
  useGlobalShortcuts({
    onNewCapture: () => {
      if (view !== 'recording' && !showCommandPalette && !showWelcome && !showSettingsOverlay) {
        setView('capture')
      }
    },
    onNewSession: () => {
      if (view !== 'recording' && !showCommandPalette && !showWelcome && !showSettingsOverlay) {
        handleStartSession()
      }
    },
    onGoHome: () => {
      if (view !== 'recording' && !showCommandPalette && !showWelcome && !showSettingsOverlay) {
        handleBack()
      }
    },
    onSearch: () => {
      if (!showWelcome && !showSettingsOverlay) {
        setShowCommandPalette(prev => !prev)
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
      if (view === 'recording') {
        setShowSettingsOverlay(true)
      } else {
        setView('settings')
      }
    }
    window.addEventListener('navigate-to-settings', handleNavigateToSettings)
    return () => {
      window.removeEventListener('navigate-to-settings', handleNavigateToSettings)
    }
  }, [view])

  // Clear stale session reference if session was deleted
  useEffect(() => {
    if (selectedSession && !state.sessions.some(s => s.id === selectedSession.id)) {
      setSelectedSession(null)
      if (view === 'summary') {
        setView('home')
      }
    }
  }, [state.sessions, selectedSession, view])

  // Migrate API keys from localStorage to secure storage on startup
  useEffect(() => {
    migrateToSecureStorage().catch(console.error)
  }, [])

  return (
    <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
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
          <ErrorBoundary
            key="recording-boundary"
            onError={(error) => {
              console.error('[App] Recording error boundary caught:', error)
              // Clean up recording state when error boundary catches
              Promise.all([
                sessionRecorder.isRecording()
                  ? sessionRecorder.stopRecording().catch(() => {})
                  : Promise.resolve(),
                state.activeSession
                  ? sessionBridge.stopSession(state.activeSession.id).catch(() => {})
                  : Promise.resolve(),
              ]).catch(() => {})
            }}
            onReset={() => {
              // Go back to home on reset
              dispatch({ type: 'STOP_RECORDING' })
              setView('home')
            }}
          >
            <SessionRecording
              key="recording"
              onComplete={handleRecordingComplete}
              onCancel={handleBack}
            />
          </ErrorBoundary>
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
        onGoHome={() => {
          setSelectedSession(null)
          setView('home')
          setShowSettingsOverlay(false)
          setShowCommandPalette(false)
        }}
      />

      {/* Welcome Modal (first-run) */}
      <WelcomeModal
        isOpen={showWelcome}
        onAddApiKey={handleWelcomeAddApiKey}
        onGetStarted={handleWelcomeGetStarted}
      />

      {/* Settings Overlay (while recording) */}
      {showSettingsOverlay && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm">
          <div className="absolute inset-0 overflow-y-auto">
            <Settings onBack={() => setShowSettingsOverlay(false)} />
          </div>
        </div>
      )}
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
