/**
 * ScreenPicker
 *
 * Container for screen selection during recording setup.
 * Shows responsive grid of ScreenThumbnails with multi-select support.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { ScreenThumbnail } from './ScreenThumbnail'
import {
  getScreens,
  isTauri,
  checkScreenRecordingPermission,
  requestScreenRecordingPermission,
  type ScreenInfo,
} from '../services/recording'

interface ScreenPickerProps {
  /** Currently selected screen IDs */
  selectedScreens: string[]
  /** Called when selection changes */
  onSelectionChange: (screenIds: string[]) => void
  /** Whether the picker is disabled */
  disabled?: boolean
}

export function ScreenPicker({
  selectedScreens,
  onSelectionChange,
  disabled,
}: ScreenPickerProps) {
  const [screens, setScreens] = useState<ScreenInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Use refs to avoid callback dependencies causing infinite loops
  const onSelectionChangeRef = useRef(onSelectionChange)
  const selectedScreensRef = useRef(selectedScreens)

  // Keep refs up to date
  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange
    selectedScreensRef.current = selectedScreens
  })

  // Load screens - no callback deps needed since we use refs
  const loadScreens = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      if (isTauri()) {
        // Check permission first
        const permitted = await checkScreenRecordingPermission()
        setHasPermission(permitted)

        if (!permitted) {
          setIsLoading(false)
          return
        }

        // Load screens
        const displays = await getScreens()
        setScreens(displays)

        // Auto-select primary screen if nothing selected
        if (selectedScreensRef.current.length === 0 && displays.length > 0) {
          const primary = displays.find(s => s.isPrimary)
          if (primary) {
            onSelectionChangeRef.current([primary.id])
          } else {
            onSelectionChangeRef.current([displays[0].id])
          }
        }
      } else {
        // Browser mock
        const mockScreens: ScreenInfo[] = [
          {
            id: '0',
            name: 'Primary Display',
            width: 1920,
            height: 1080,
            x: 0,
            y: 0,
            isPrimary: true,
          },
        ]
        setScreens(mockScreens)
        setHasPermission(true)

        if (selectedScreensRef.current.length === 0) {
          onSelectionChangeRef.current(['0'])
        }
      }
    } catch (e) {
      console.error('Failed to load screens:', e)
      setError(e instanceof Error ? e.message : 'Failed to load displays')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Load screens only once on mount
  useEffect(() => {
    loadScreens()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally run once on mount
  }, [])

  // Handle permission request
  const handleRequestPermission = async () => {
    try {
      const granted = await requestScreenRecordingPermission()
      setHasPermission(granted)
      if (granted) {
        loadScreens()
      }
    } catch (e) {
      console.error('Permission request failed:', e)
    }
  }

  // Toggle screen selection
  const toggleScreen = (screenId: string) => {
    if (disabled) return

    const isSelected = selectedScreens.includes(screenId)

    if (isSelected) {
      // Don't allow deselecting the last screen
      if (selectedScreens.length <= 1) return
      onSelectionChange(selectedScreens.filter(id => id !== screenId))
    } else {
      onSelectionChange([...selectedScreens, screenId])
    }
  }

  // Single screen case
  const isSingleScreen = screens.length === 1

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="label-section">Select Screen</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2].map(i => (
            <div
              key={i}
              className="aspect-video rounded-xl bg-[var(--paper-dark)] animate-pulse"
            />
          ))}
        </div>
      </div>
    )
  }

  // Permission required
  if (hasPermission === false) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-6 rounded-xl bg-[var(--error-muted)] border border-[var(--error)]/20"
      >
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-[var(--error)] flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-[var(--error)]">
              Screen recording permission required
            </p>
            <p className="text-xs text-[var(--error)]/80 mt-1">
              Grant permission in System Settings to capture your screen
            </p>
            <button
              onClick={handleRequestPermission}
              className="mt-4 px-4 py-2 rounded-lg bg-[var(--error)] text-white text-sm font-medium hover:bg-[var(--error)]/90 transition-colors"
            >
              Grant Permission
            </button>
          </div>
        </div>
      </motion.div>
    )
  }

  // Error state
  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-6 rounded-xl bg-[var(--paper-warm)] border border-[var(--border-subtle)]"
      >
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-[var(--ink-muted)] flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-[var(--ink)]">
              {error}
            </p>
            <button
              onClick={loadScreens}
              className="mt-3 flex items-center gap-2 text-sm text-[var(--accent)] hover:underline"
            >
              <RefreshCw className="w-4 h-4" />
              Try again
            </button>
          </div>
        </div>
      </motion.div>
    )
  }

  // No screens found
  if (screens.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-6 rounded-xl bg-[var(--paper-warm)] border border-[var(--border-subtle)] text-center"
      >
        <p className="text-sm text-[var(--ink-muted)]">
          No displays found. Please check your connections.
        </p>
        <button
          onClick={loadScreens}
          className="mt-3 flex items-center gap-2 text-sm text-[var(--accent)] hover:underline mx-auto"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </motion.div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="label-section">
          {isSingleScreen ? 'Your Screen' : `Select Screen${screens.length > 1 ? 's' : ''}`}
        </h3>
        {!isSingleScreen && selectedScreens.length > 1 && (
          <span className="text-xs text-[var(--ink-muted)] px-2 py-1 rounded-full bg-[var(--paper-dark)]">
            {selectedScreens.length} selected
          </span>
        )}
      </div>

      <motion.div
        initial="hidden"
        animate="visible"
        variants={{
          hidden: { opacity: 0 },
          visible: {
            opacity: 1,
            transition: { staggerChildren: 0.1 },
          },
        }}
        className={`grid gap-4 ${
          isSingleScreen
            ? 'grid-cols-1 max-w-sm'
            : screens.length === 2
              ? 'grid-cols-1 sm:grid-cols-2'
              : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
        }`}
      >
        {screens.map((screen, index) => (
          <motion.div
            key={screen.id}
            variants={{
              hidden: { opacity: 0, y: 20 },
              visible: { opacity: 1, y: 0 },
            }}
          >
            <ScreenThumbnail
              screen={screen}
              isSelected={selectedScreens.includes(screen.id)}
              onToggle={() => toggleScreen(screen.id)}
              disabled={disabled}
              isOnlyScreen={isSingleScreen}
              loadDelay={index * 300}
            />
          </motion.div>
        ))}
      </motion.div>

      {!isSingleScreen && (
        <p className="text-xs text-[var(--ink-muted)]">
          Click to select multiple screens
        </p>
      )}
    </div>
  )
}
