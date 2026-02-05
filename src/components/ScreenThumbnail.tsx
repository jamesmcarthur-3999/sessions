/**
 * ScreenThumbnail
 *
 * Individual screen preview card for the screen picker.
 * Shows live preview, resolution, name, and selection state.
 */

import { useState, useEffect, memo } from 'react'
import { motion } from 'framer-motion'
import { Check, Monitor } from 'lucide-react'
import type { ScreenInfo } from '../services/recording'

interface ScreenThumbnailProps {
  screen: ScreenInfo
  isSelected: boolean
  onToggle: () => void
  disabled?: boolean
  /** If true, don't show interactive selection (single screen case) */
  isOnlyScreen?: boolean
  /** Delay in ms before loading thumbnail (for staggered loading) */
  loadDelay?: number
}

export const ScreenThumbnail = memo(function ScreenThumbnail({
  screen,
  isSelected,
  onToggle,
  disabled,
  isOnlyScreen,
  loadDelay = 0,
}: ScreenThumbnailProps) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Load thumbnail preview - significantly deferred to avoid blocking UI render
  // The screenshot capture is expensive (full screen capture + PNG + base64 + IPC transfer)
  // so we let the UI render and become interactive first, then load thumbnails
  useEffect(() => {
    let isMounted = true
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    async function loadThumbnail() {
      try {
        // Try to capture a preview screenshot via Tauri
        if (typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window)) {
          const { invoke } = await import('@tauri-apps/api/core')
          try {
            // Use test_capture_screenshot which returns a resized thumbnail (400px width)
            // instead of capture_screenshot which returns full resolution (2-5MB)
            const base64 = await invoke<string>('test_capture_screenshot', {
              screenId: screen.id,
            })
            if (isMounted && base64) {
              setThumbnailUrl(`data:image/png;base64,${base64}`)
            }
          } catch (e) {
            console.warn('Failed to capture screen thumbnail:', e)
          }
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    // Significantly defer thumbnail loading to ensure UI is fully interactive
    // before we start expensive screenshot operations. This prevents the 5+ second
    // freeze users experience when opening session setup.
    // Base delay of 500ms + staggered delay per screen to avoid parallel captures
    // Use requestIdleCallback if available for even better scheduling
    const scheduleLoad = () => {
      if ('requestIdleCallback' in window) {
        (window as Window & { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback(() => {
          if (isMounted) loadThumbnail()
        })
      } else {
        loadThumbnail()
      }
    }

    const totalDelay = 500 + loadDelay
    timeoutId = setTimeout(scheduleLoad, totalDelay)

    return () => {
      isMounted = false
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }, [screen.id, loadDelay])

  const displayName = isOnlyScreen
    ? 'Your screen'
    : screen.name || `Display ${parseInt(screen.id) + 1}`

  return (
    <motion.button
      onClick={onToggle}
      disabled={disabled || isOnlyScreen}
      whileHover={!disabled && !isOnlyScreen ? { scale: 1.02 } : undefined}
      whileTap={!disabled && !isOnlyScreen ? { scale: 0.98 } : undefined}
      className={`
        relative w-full aspect-video rounded-xl overflow-hidden
        border-2 transition-all duration-200
        ${isSelected
          ? 'border-[var(--session-recording)] shadow-[var(--shadow-lg)]'
          : 'border-[var(--border-subtle)] hover:border-[var(--border-medium)]'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : isOnlyScreen ? 'cursor-default' : 'cursor-pointer'}
        focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--session-recording)] focus-visible:ring-offset-2
      `}
      aria-pressed={isSelected}
      aria-label={`${displayName}, ${screen.width} by ${screen.height}${isSelected ? ', selected' : ''}`}
    >
      {/* Thumbnail preview or placeholder */}
      <div className="absolute inset-0 bg-[var(--paper-dark)]">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={`Preview of ${displayName}`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {isLoading ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                className="w-8 h-8 rounded-full border-2 border-[var(--ink-muted)]/30 border-t-[var(--ink-muted)]"
              />
            ) : (
              <Monitor className="w-12 h-12 text-[var(--ink-muted)]/50" />
            )}
          </div>
        )}
      </div>

      {/* Selection overlay */}
      {isSelected && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute inset-0 bg-[var(--session-recording)]/10"
        />
      )}

      {/* Checkmark */}
      {isSelected && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="absolute top-3 right-3 w-7 h-7 rounded-full bg-[var(--session-recording)] flex items-center justify-center shadow-lg"
        >
          <Check className="w-4 h-4 text-white" strokeWidth={3} />
        </motion.div>
      )}

      {/* Info bar at bottom */}
      <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/70 to-transparent">
        <p className="text-sm font-medium text-white truncate">
          {displayName}
        </p>
        <p className="text-xs text-white/70">
          {screen.width}×{screen.height}
          {screen.isPrimary && !isOnlyScreen && (
            <span className="ml-2 px-1.5 py-0.5 rounded bg-white/20 text-[10px] uppercase tracking-wide">
              Primary
            </span>
          )}
        </p>
      </div>
    </motion.button>
  )
})
