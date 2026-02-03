/**
 * Screenshot Gallery
 *
 * Displays captured screenshots from a session in a grid/carousel.
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import type { DbScreenshot } from '../types/database'

interface ScreenshotGalleryProps {
  screenshots: DbScreenshot[]
}

export function ScreenshotGallery({ screenshots }: ScreenshotGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)

  if (screenshots.length === 0) {
    return null
  }

  const selectedScreenshot = selectedIndex !== null ? screenshots[selectedIndex] : null
  const displayCount = showAll ? screenshots.length : Math.min(9, screenshots.length)

  return (
    <>
      {/* Grid View */}
      <div className="grid grid-cols-3 gap-3">
        {screenshots.slice(0, displayCount).map((ss, index) => (
          <button
            key={ss.id}
            onClick={() => setSelectedIndex(index)}
            className="aspect-video rounded-lg overflow-hidden border border-[var(--border-subtle)] hover:border-[var(--accent)] transition-colors relative group"
          >
            <img
              src={ss.data_base64.startsWith('data:') ? ss.data_base64 : `data:image/png;base64,${ss.data_base64}`}
              alt={`Screenshot ${index + 1}`}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
            <div className="absolute bottom-1 left-1 text-xs text-white bg-black/50 px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity">
              {new Date(ss.captured_at).toLocaleTimeString()}
            </div>
          </button>
        ))}
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
                className="absolute right-4 p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
              >
                <ChevronRight className="w-6 h-6 text-white" />
              </button>
            )}

            <div onClick={(e) => e.stopPropagation()} className="max-w-5xl max-h-[80vh] px-16">
              <img
                src={selectedScreenshot.data_base64.startsWith('data:')
                  ? selectedScreenshot.data_base64
                  : `data:image/png;base64,${selectedScreenshot.data_base64}`}
                alt="Screenshot"
                className="max-w-full max-h-[80vh] object-contain rounded-lg"
              />
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
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
