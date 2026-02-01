import { useState } from 'react'
import { Home } from './components/Home'
import { SummaryView } from './components/SummaryView'
import { History } from './components/History'
import type { Session } from './types'

type View = 'home' | 'summary' | 'history'

function App() {
  const [view, setView] = useState<View>('home')
  const [selectedSession, setSelectedSession] = useState<Session | null>(null)

  const handleSessionSelect = (session: Session) => {
    setSelectedSession(session)
    setView('summary')
  }

  const handleBack = () => {
    setSelectedSession(null)
    setView('home')
  }

  return (
    <div className="min-h-screen bg-white dark:bg-neutral-950">
      {view === 'home' && (
        <Home
          onNavigate={setView}
          onSessionSelect={handleSessionSelect}
        />
      )}
      {view === 'summary' && selectedSession && (
        <SummaryView
          session={selectedSession}
          onBack={handleBack}
        />
      )}
      {view === 'history' && (
        <History
          onBack={handleBack}
          onSessionSelect={handleSessionSelect}
        />
      )}
    </div>
  )
}

export default App
