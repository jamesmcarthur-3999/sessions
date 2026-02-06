import { motion } from 'framer-motion'

interface ProcessingSpinnerProps {
  /** Primary status text */
  message?: string
  /** Secondary description text */
  description?: string
}

/**
 * Geometric processing animation with optional status text.
 * Used during AI processing (captures, summaries, etc.)
 */
export function ProcessingSpinner({ message, description }: ProcessingSpinnerProps) {
  return (
    <div className="flex flex-col items-center justify-center">
      {/* Geometric animation */}
      <div className="relative w-28 h-28 mb-10">
        {/* Outer ring */}
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
          className="absolute inset-0"
        >
          <div className="absolute inset-0 rounded-full border border-[var(--accent)]/20" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
        </motion.div>

        {/* Middle ring */}
        <motion.div
          animate={{ rotate: -360 }}
          transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
          className="absolute inset-4"
        >
          <div className="absolute inset-0 rounded-full border border-[var(--accent)]/30" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-[var(--accent)]" />
        </motion.div>

        {/* Center pulse */}
        <motion.div
          animate={{ scale: [0.8, 1, 0.8], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-8 rounded-full bg-[var(--accent)]"
        />
      </div>

      {message && (
        <motion.p
          key={message}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-display text-xl text-[var(--ink)]"
        >
          {message}
        </motion.p>
      )}
      {description && (
        <p className="text-sm text-[var(--ink-muted)] mt-2">
          {description}
        </p>
      )}
    </div>
  )
}
