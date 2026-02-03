import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { HelpCircle } from 'lucide-react'

interface TooltipProps {
  content: string
  children?: React.ReactNode
}

export function Tooltip({ content, children }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [position, setPosition] = useState<'top' | 'bottom'>('top')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (isVisible && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      // If not enough space above, show below
      setPosition(rect.top < 80 ? 'bottom' : 'top')
    }
  }, [isVisible])

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => setIsVisible(true), 200)
  }

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    setIsVisible(false)
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return (
    <span className="relative inline-flex items-center">
      {children}
      <button
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={() => setIsVisible(!isVisible)}
        className="ml-1 text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors"
        aria-label="Help"
        type="button"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>

      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={{ opacity: 0, y: position === 'top' ? 4 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={`absolute z-50 px-3 py-2 text-sm rounded-lg bg-[var(--ink)] text-[var(--paper)] shadow-lg max-w-xs whitespace-normal ${
              position === 'top'
                ? 'bottom-full mb-2'
                : 'top-full mt-2'
            } left-1/2 -translate-x-1/2`}
          >
            {content}
            {/* Arrow */}
            <div
              className={`absolute left-1/2 -translate-x-1/2 w-2 h-2 bg-[var(--ink)] rotate-45 ${
                position === 'top'
                  ? '-bottom-1'
                  : '-top-1'
              }`}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  )
}
