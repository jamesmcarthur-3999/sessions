/**
 * ConfirmDialog
 *
 * Reusable confirmation dialog with customizable title, message, and actions.
 */

import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  confirmVariant?: 'danger' | 'primary'
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  confirmVariant = 'primary',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={onCancel}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-sm mx-4 bg-[var(--paper)] rounded-2xl border border-[var(--border-subtle)] shadow-[var(--shadow-xl)] overflow-hidden"
        >
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                confirmVariant === 'danger' ? 'bg-[var(--error-muted)]' : 'bg-[var(--accent-muted)]'
              }`}>
                <AlertTriangle className={`w-5 h-5 ${
                  confirmVariant === 'danger' ? 'text-[var(--error)]' : 'text-[var(--accent)]'
                }`} />
              </div>
              <div>
                <h3 className="font-medium text-[var(--ink)] text-lg">{title}</h3>
                <p className="text-sm text-[var(--ink-muted)] mt-1">{message}</p>
              </div>
            </div>
          </div>

          <div className="px-6 py-4 bg-[var(--paper-warm)] border-t border-[var(--border-subtle)] flex justify-end gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg border border-[var(--border-medium)] text-[var(--ink)] hover:bg-[var(--paper)] transition-colors text-sm"
            >
              {cancelText}
            </button>
            <button
              onClick={onConfirm}
              className={`px-4 py-2 rounded-lg text-white font-medium transition-colors text-sm ${
                confirmVariant === 'danger'
                  ? 'bg-[var(--error)] hover:bg-[var(--error)]/80'
                  : 'bg-[var(--accent)] hover:bg-[var(--accent)]/80'
              }`}
            >
              {confirmText}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
