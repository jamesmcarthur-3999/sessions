import type { LucideIcon } from 'lucide-react'

interface IconBadgeProps {
  icon: LucideIcon
  /** Tailwind bg color class (e.g. "bg-[var(--accent)]/10") */
  bg: string
  /** Tailwind text color class (e.g. "text-[var(--accent)]") */
  color: string
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
}

const sizes = {
  sm: { container: 'w-8 h-8 rounded-lg', icon: 'w-4 h-4' },
  md: { container: 'w-10 h-10 rounded-xl', icon: 'w-5 h-5' },
  lg: { container: 'w-14 h-14 rounded-xl', icon: 'w-6 h-6' },
}

export function IconBadge({ icon: Icon, bg, color, size = 'md' }: IconBadgeProps) {
  const s = sizes[size]
  return (
    <div className={`${s.container} ${bg} flex items-center justify-center`}>
      <Icon className={`${s.icon} ${color}`} />
    </div>
  )
}
