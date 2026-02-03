/**
 * ScreenPreview
 *
 * Shows a live preview of what will be captured from the selected screen.
 */

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Monitor, RefreshCw, Check, X, Loader2 } from 'lucide-react'
import { testCaptureScreenshot, isTauri } from '../services/recording'

interface ScreenPreviewProps {
  screenId: string | null
  screenName: string
  onClose: () => void
}

export function ScreenPreview({ screenId, screenName, onClose }: ScreenPreviewProps) {
  const [preview, setPreview] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const capturePreview = useCallback(async () => {
    if (!isTauri()) {
      setError('Preview only available in desktop app')
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const screenshot = await testCaptureScreenshot(screenId)
      setPreview(screenshot)
    } catch (err) {
      console.error('Failed to capture preview:', err)
      setError(err instanceof Error ? err.message : 'Failed to capture screen')
    } finally {
      setIsLoading(false)
    }
  }, [screenId])

  useEffect(() => {
    capturePreview()
  }, [capturePreview])

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="mt-3 rounded-xl border border-[var(--border-medium)] overflow-hidden bg-[var(--paper-dark)]"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-[var(--ink-muted)]" />
          <span className="text-sm text-[var(--ink)]">{screenName} Preview</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={capturePreview}
            disabled={isLoading}
            className="p-1.5 rounded-lg hover:bg-[var(--paper-warm)] transition-colors disabled:opacity-50"
            title="Refresh preview"
          >
            <RefreshCw className={`w-4 h-4 text-[var(--ink-muted)] ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--paper-warm)] transition-colors"
            title="Close preview"
          >
            <X className="w-4 h-4 text-[var(--ink-muted)]" />
          </button>
        </div>
      </div>

      {/* Preview area */}
      <div className="relative aspect-video bg-black/50 flex items-center justify-center">
        {isLoading && (
          <div className="flex flex-col items-center gap-2 text-[var(--ink-muted)]">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-xs">Capturing preview...</span>
          </div>
        )}

        {error && !isLoading && (
          <div className="flex flex-col items-center gap-2 text-[var(--error)] px-4 text-center">
            <X className="w-6 h-6" />
            <span className="text-xs">{error}</span>
          </div>
        )}

        {preview && !isLoading && !error && (
          <>
            <img
              src={preview}
              alt="Screen preview"
              className="max-w-full max-h-full object-contain"
            />
            <div className="absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--success)]/90 text-white text-xs">
              <Check className="w-3 h-3" />
              <span>Ready to capture</span>
            </div>
          </>
        )}
      </div>
    </motion.div>
  )
}
