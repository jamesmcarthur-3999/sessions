import { useState, useEffect, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search,
  Video,
  MessageSquare,
  Clock,
  Plus,
  Home,
  Command,
} from 'lucide-react'
import type { Session } from '../types'

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  sessions: Session[]
  onSessionSelect: (session: Session) => void
  onNewCapture: () => void
  onNewSession: () => void
  onGoToHistory: () => void
}

interface Command {
  id: string
  type: 'action' | 'session'
  icon: React.ReactNode
  title: string
  subtitle?: string
  shortcut?: string
  onSelect: () => void
}

export function CommandPalette({
  isOpen,
  onClose,
  sessions,
  onSessionSelect,
  onNewCapture,
  onNewSession,
  onGoToHistory,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [isOpen])

  // Build command list
  const commands = useMemo(() => {
    const result: Command[] = []

    // Actions
    const actions: Command[] = [
      {
        id: 'new-capture',
        type: 'action',
        icon: <Plus className="w-4 h-4" />,
        title: 'New Capture',
        subtitle: 'Quick capture text or paste',
        shortcut: '⌘N',
        onSelect: onNewCapture,
      },
      {
        id: 'new-session',
        type: 'action',
        icon: <Video className="w-4 h-4" />,
        title: 'Start Session',
        subtitle: 'Record screen and audio',
        shortcut: '⇧⌘N',
        onSelect: onNewSession,
      },
      {
        id: 'history',
        type: 'action',
        icon: <Clock className="w-4 h-4" />,
        title: 'View History',
        subtitle: 'See all past sessions',
        onSelect: onGoToHistory,
      },
      {
        id: 'home',
        type: 'action',
        icon: <Home className="w-4 h-4" />,
        title: 'Go Home',
        shortcut: '⌘H',
        onSelect: onClose,
      },
    ]

    // Filter actions
    if (!query.trim()) {
      result.push(...actions)
    } else {
      const lowerQuery = query.toLowerCase()
      result.push(
        ...actions.filter(
          (a) =>
            a.title.toLowerCase().includes(lowerQuery) ||
            a.subtitle?.toLowerCase().includes(lowerQuery)
        )
      )
    }

    // Add matching sessions
    const sessionCommands: Command[] = sessions.map((session) => ({
      id: session.id,
      type: 'session',
      icon:
        session.type === 'session' ? (
          <Video className="w-4 h-4 text-red-500" />
        ) : (
          <MessageSquare className="w-4 h-4 text-blue-500" />
        ),
      title: session.title,
      subtitle: session.summary?.text?.substring(0, 60) + '...' || undefined,
      onSelect: () => onSessionSelect(session),
    }))

    if (query.trim()) {
      const lowerQuery = query.toLowerCase()
      result.push(
        ...sessionCommands.filter(
          (s) =>
            s.title.toLowerCase().includes(lowerQuery) ||
            s.subtitle?.toLowerCase().includes(lowerQuery)
        )
      )
    } else {
      // Show recent sessions when no query
      result.push(...sessionCommands.slice(0, 3))
    }

    return result
  }, [query, sessions, onNewCapture, onNewSession, onGoToHistory, onSessionSelect, onClose])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((i) => Math.min(i + 1, commands.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((i) => Math.max(i - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (commands[selectedIndex]) {
            commands[selectedIndex].onSelect()
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, commands, selectedIndex, onClose])

  // Keep selected index in bounds
  useEffect(() => {
    if (selectedIndex >= commands.length) {
      setSelectedIndex(Math.max(0, commands.length - 1))
    }
  }, [commands.length, selectedIndex])

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
          />

          {/* Palette */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ duration: 0.15 }}
            className="fixed left-1/2 top-[20%] z-50 w-full max-w-lg -translate-x-1/2"
          >
            <div className="mx-4 overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-2xl">
              {/* Search input */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
                <Search className="w-5 h-5 text-neutral-400" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setSelectedIndex(0)
                  }}
                  placeholder="Search commands and sessions..."
                  className="flex-1 bg-transparent text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none"
                />
                <div className="flex items-center gap-1 px-2 py-1 rounded bg-neutral-100 dark:bg-neutral-800">
                  <Command className="w-3 h-3 text-neutral-500" />
                  <span className="text-xs text-neutral-500">K</span>
                </div>
              </div>

              {/* Results */}
              <div className="max-h-80 overflow-y-auto p-2">
                {commands.length === 0 ? (
                  <div className="px-4 py-8 text-center text-neutral-400">
                    No results found
                  </div>
                ) : (
                  commands.map((command, index) => (
                    <button
                      key={command.id}
                      onClick={command.onSelect}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                        index === selectedIndex
                          ? 'bg-neutral-100 dark:bg-neutral-800'
                          : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
                      }`}
                    >
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          command.type === 'action'
                            ? 'bg-neutral-100 dark:bg-neutral-800'
                            : 'bg-transparent'
                        }`}
                      >
                        {command.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-neutral-900 dark:text-neutral-100 truncate">
                          {command.title}
                        </div>
                        {command.subtitle && (
                          <div className="text-sm text-neutral-500 truncate">
                            {command.subtitle}
                          </div>
                        )}
                      </div>
                      {command.shortcut && (
                        <div className="text-xs text-neutral-400">
                          {command.shortcut}
                        </div>
                      )}
                    </button>
                  ))
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-4 py-2 border-t border-neutral-200 dark:border-neutral-800 text-xs text-neutral-400">
                <div className="flex items-center gap-4">
                  <span>↑↓ navigate</span>
                  <span>↵ select</span>
                  <span>esc close</span>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
