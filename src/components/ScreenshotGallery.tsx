/**
 * Screenshot Gallery
 *
 * Displays captured screenshots from a session in a grid/carousel.
 * Lazy-loads image data on demand to avoid loading 50-100MB upfront.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronLeft, ChevronRight, ImageOff } from 'lucide-react'
import type { DbScreenshot } from '../types/database'
import { logger } from '../utils/logger'
import { loadScreenshotData } from '../services/screenshot-storage'

// Maximum number of images to keep in memory (LRU eviction)
const MAX_CACHED_IMAGES = 50

interface ScreenshotGalleryProps {
  screenshots: DbScreenshot[]
}

export function ScreenshotGallery({ screenshots }: ScreenshotGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)
  // Cache of loaded image data URLs, keyed by screenshot id
  const [loadedImages, setLoadedImages] = useState<Record<string, string>>({})
  const [loadingImages, setLoadingImages] = useState<Set<string>>(new Set())

  // Use refs to track loading state without recreating loadImage callback
  const loadingRef = useRef<Set<string>>(new Set())
  const loadedRef = useRef<Set<string>>(new Set())

  // Load image data for a screenshot (lazy, on demand)
  const loadImage = useCallback(async (screenshot: DbScreenshot) => {
    const id = screenshot.id

    // Already loaded or loading (check refs to avoid stale closure)
    if (loadedRef.current.has(id) || loadingRef.current.has(id)) return

    // No file_path = no image (legacy screenshots won't display)
    if (!screenshot.file_path) return

    loadingRef.current.add(id)
    setLoadingImages(new Set(loadingRef.current))

    try {
      const dataUrl = await loadScreenshotData(screenshot.file_path)
      loadedRef.current.add(id)

      // Add to cache with LRU eviction to bound memory usage
      setLoadedImages(prev => {
        const entries = Object.entries(prev)
        if (entries.length >= MAX_CACHED_IMAGES) {
          // Remove oldest entries (first ones added)
          const toKeep = entries.slice(-MAX_CACHED_IMAGES + 1)
          return { ...Object.fromEntries(toKeep), [id]: dataUrl }
        }
        return { ...prev, [id]: dataUrl }
      })
    } catch (error) {
      logger.error('Failed to load screenshot:', id, error)
    } finally {
      loadingRef.current.delete(id)
      setLoadingImages(new Set(loadingRef.current))
    }
  }, [])

  // Preload visible thumbnails
  useEffect(() => {
    const displayCount = showAll ? screenshots.length : Math.min(9, screenshots.length)
    screenshots.slice(0, displayCount).forEach(ss => {
      loadImage(ss)
    })
  }, [screenshots, showAll, loadImage])

  // Preload adjacent images when viewing in lightbox
  useEffect(() => {
    if (selectedIndex === null) return

    // Load prev/next images for smooth navigation
    if (selectedIndex > 0) {
      loadImage(screenshots[selectedIndex - 1])
    }
    if (selectedIndex < screenshots.length - 1) {
      loadImage(screenshots[selectedIndex + 1])
    }
  }, [selectedIndex, screenshots, loadImage])

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (selectedIndex === null) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          setSelectedIndex(prev => prev !== null && prev > 0 ? prev - 1 : prev)
          break
        case 'ArrowRight':
          e.preventDefault()
          setSelectedIndex(prev => prev !== null && prev < screenshots.length - 1 ? prev + 1 : prev)
          break
        case 'Escape':
          e.preventDefault()
          setSelectedIndex(null)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedIndex, screenshots.length])

  if (screenshots.length === 0) {
    return null
  }

  const selectedScreenshot = selectedIndex !== null ? screenshots[selectedIndex] : null
  const displayCount = showAll ? screenshots.length : Math.min(9, screenshots.length)

  return (
    <>
      {/* Grid View */}
      <div className="grid grid-cols-3 gap-3">
        {screenshots.slice(0, displayCount).map((ss, index) => {
          const imageUrl = loadedImages[ss.id]
          const isLoading = loadingImages.has(ss.id)

          return (
            <button
              key={ss.id}
              onClick={() => {
                loadImage(ss) // Ensure full image is loaded for lightbox
                setSelectedIndex(index)
              }}
              className="aspect-video rounded-lg overflow-hidden border border-[var(--border-subtle)] hover:border-[var(--accent)] transition-colors relative group"
            >
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={`Screenshot ${index + 1}`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-[var(--paper-warm)] flex items-center justify-center">
                  {isLoading ? (
                    <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <ImageOff className="w-6 h-6 text-[var(--ink-muted)]" />
                  )}
                </div>
              )}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
              <div className="absolute bottom-1 left-1 text-xs text-white bg-black/50 px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                {new Date(ss.captured_at).toLocaleTimeString()}
              </div>
            </button>
          )
        })}
        {/* Show more/less toggle */}
        {screenshots.length > 9 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="aspect-video rounded-lg bg-[var(--paper-warm)] border border-dashed border-[var(--border-medium)] flex items-center justify-center hover:bg-[var(--paper-dark)] transition-colors"
          >
            <span className="text-sm text-[var(--ink-muted)]">
              {showAll ? 'Show less' : `+${screenshots.length - 9} more`}
            </span>
          </button>
        )}
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {selectedScreenshot && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
            onClick={() => setSelectedIndex(null)}
          >
            <button
              onClick={() => setSelectedIndex(null)}
              aria-label="Close screenshot viewer"
              className="absolute top-4 right-4 p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
            >
              <X className="w-6 h-6 text-white" />
            </button>

            {selectedIndex !== null && selectedIndex > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setSelectedIndex(selectedIndex - 1)
                }}
                aria-label="Previous screenshot"
                className="absolute left-4 p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              >
                <ChevronLeft className="w-6 h-6 text-white" />
              </button>
            )}

            {selectedIndex !== null && selectedIndex < screenshots.length - 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setSelectedIndex(selectedIndex + 1)
                }}
                aria-label="Next screenshot"
                className="absolute right-4 p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              >
                <ChevronRight className="w-6 h-6 text-white" />
              </button>
            )}

            <div onClick={(e) => e.stopPropagation()} className="max-w-5xl max-h-[80vh] px-16">
              {loadedImages[selectedScreenshot.id] ? (
                <img
                  src={loadedImages[selectedScreenshot.id]}
                  alt="Screenshot"
                  className="max-w-full max-h-[80vh] object-contain rounded-lg"
                />
              ) : (
                <div className="flex items-center justify-center h-[60vh]">
                  <div className="w-10 h-10 border-3 border-white border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              <div className="mt-4 text-center">
                <p className="text-white/80 text-sm">
                  {new Date(selectedScreenshot.captured_at).toLocaleString()}
                  {selectedScreenshot.app_name && ` • ${selectedScreenshot.app_name}`}
                </p>
                {selectedScreenshot.analysis && (
                  <p className="text-white/60 text-sm mt-2 max-w-2xl mx-auto">
                    {selectedScreenshot.analysis}
                  </p>
                )}
              </div>
            </div>

            {/* Keyboard hints */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-4 text-xs text-white/40">
              <span>← → Navigate</span>
              <span>ESC Close</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
