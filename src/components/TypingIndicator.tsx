import { motion } from 'framer-motion'

export function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-4 py-2">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          animate={{
            y: [0, -4, 0],
            opacity: [0.4, 1, 0.4]
          }}
          transition={{
            duration: 0.6,
            repeat: Infinity,
            delay: i * 0.15,
            ease: "easeInOut"
          }}
          className="w-2 h-2 rounded-full bg-[var(--ink-muted)]"
        />
      ))}
    </div>
  )
}
