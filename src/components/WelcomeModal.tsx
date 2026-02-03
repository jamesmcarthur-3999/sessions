import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles } from 'lucide-react'

interface WelcomeModalProps {
  isOpen: boolean
  onAddApiKey: () => void
  onGetStarted: () => void
}

export function WelcomeModal({ isOpen, onAddApiKey, onGetStarted }: WelcomeModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-[var(--ink)]/50 backdrop-blur-sm z-50"
            onClick={onGetStarted}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div
              className="bg-[var(--paper)] rounded-2xl shadow-2xl max-w-md w-full p-8 text-center"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Logo */}
              <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-[var(--accent)] flex items-center justify-center">
                <Sparkles className="w-8 h-8 text-white" />
              </div>

              {/* Tagline */}
              <h1 className="text-2xl font-semibold text-[var(--ink)] mb-3">
                Your work, distilled.
              </h1>

              {/* Description */}
              <p className="text-[var(--ink-muted)] mb-8">
                Sessions captures what you do and transforms it into clear summaries, tasks, and insights.
              </p>

              {/* Buttons */}
              <div className="flex gap-3">
                <motion.button
                  onClick={onAddApiKey}
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  className="flex-1 px-4 py-3 rounded-xl border border-[var(--border-subtle)] text-[var(--ink)] hover:bg-[var(--paper-warm)] transition-colors"
                >
                  Add API Key
                </motion.button>
                <motion.button
                  onClick={onGetStarted}
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                  className="flex-1 px-4 py-3 rounded-xl bg-[var(--ink)] text-[var(--paper)] hover:opacity-90 transition-opacity"
                >
                  Get Started
                </motion.button>
              </div>

              {/* Hint */}
              <p className="text-sm text-[var(--ink-muted)] mt-6">
                <kbd className="px-1.5 py-0.5 rounded bg-[var(--paper-warm)] text-xs font-mono">⌘K</kbd>
                {' '}opens command palette
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
