/**
 * Design Tokens - Editorial Luxury System
 *
 * A refined design system inspired by high-end publications.
 * Warm, intellectual, confident.
 */

// ============================================================================
// SPACING - Generous, intentional whitespace
// ============================================================================

export const spacing = {
  // Page-level
  page: 'px-6 py-8 md:px-8 md:py-12',
  pageCompact: 'px-4 py-6',

  // Section gaps
  section: 'space-y-12',
  sectionCompact: 'space-y-8',

  // Card internals
  card: 'p-6',
  cardCompact: 'p-4',

  // Between elements
  stack: 'space-y-4',
  stackTight: 'space-y-2',
  stackLoose: 'space-y-6',

  // Inline
  inline: 'gap-3',
  inlineTight: 'gap-2',
  inlineLoose: 'gap-4',
} as const

// ============================================================================
// RADII - Only two options for consistency
// ============================================================================

export const radius = {
  sm: 'rounded-lg',      // 8px - buttons, inputs, chips
  md: 'rounded-xl',      // 12px - cards, modals, panels
} as const

// ============================================================================
// COLORS - CSS variable references for theme support
// ============================================================================

export const colors = {
  // Ink (text)
  ink: 'text-[var(--ink)]',
  inkLight: 'text-[var(--ink-light)]',
  inkMuted: 'text-[var(--ink-muted)]',

  // Paper (backgrounds)
  paper: 'bg-[var(--paper)]',
  paperWarm: 'bg-[var(--paper-warm)]',
  paperDark: 'bg-[var(--paper-dark)]',

  // Accent (AI/highlight moments)
  accent: 'text-[var(--accent)]',
  accentBg: 'bg-[var(--accent)]',
  accentMuted: 'bg-[var(--accent-muted)]',

  // Session types
  recording: 'text-[var(--session-recording)]',
  recordingBg: 'bg-[var(--session-recording)]',
  recordingMuted: 'bg-[var(--session-recording-muted)]',
  capture: 'text-[var(--session-capture)]',
  captureBg: 'bg-[var(--session-capture)]',
  captureMuted: 'bg-[var(--session-capture-muted)]',

  // Semantic
  success: 'text-[var(--success)]',
  successBg: 'bg-[var(--success)]',
  successMuted: 'bg-[var(--success-muted)]',
  error: 'text-[var(--error)]',
  errorBg: 'bg-[var(--error)]',
  errorMuted: 'bg-[var(--error-muted)]',

  // Borders
  border: 'border-[var(--border-subtle)]',
  borderMedium: 'border-[var(--border-medium)]',
  borderStrong: 'border-[var(--border-strong)]',
} as const

// ============================================================================
// SHADOWS
// ============================================================================

export const shadows = {
  sm: 'shadow-[var(--shadow-sm)]',
  md: 'shadow-[var(--shadow-md)]',
  lg: 'shadow-[var(--shadow-lg)]',
  xl: 'shadow-[var(--shadow-xl)]',
} as const

// ============================================================================
// TYPOGRAPHY
// ============================================================================

export const typography = {
  // Display - for hero moments (serif)
  display: 'font-display heading-display',
  displaySm: 'font-display heading-display-sm',

  // Section labels (refined uppercase)
  label: 'label-section',

  // Editorial body text (serif, larger)
  editorial: 'text-editorial',

  // UI text (system font)
  body: 'font-body text-base',
  bodySmall: 'font-body text-sm',
  bodyMuted: 'font-body text-sm text-[var(--ink-muted)]',
} as const

// ============================================================================
// COMPONENT STYLES
// ============================================================================

// Cards
export const card = {
  base: `${radius.md} ${colors.paperWarm} border ${colors.border} ${shadows.sm}`,
  interactive: `${radius.md} ${colors.paperWarm} border ${colors.border} hover:border-[var(--border-medium)] ${shadows.sm} hover:shadow-[var(--shadow-md)] transition-all duration-300`,
  elevated: `${radius.md} ${colors.paperWarm} border ${colors.border} ${shadows.lg}`,
  ai: 'ai-summary-card', // Special CSS class for AI cards
} as const

// Buttons
export const button = {
  primary: `${radius.sm} px-5 py-2.5 bg-[var(--ink)] text-[var(--paper)] hover:bg-[var(--ink-light)] transition-all duration-200 font-medium text-sm`,
  secondary: `${radius.sm} px-5 py-2.5 border ${colors.borderMedium} text-[var(--ink)] hover:bg-[var(--paper-warm)] transition-all duration-200 text-sm`,
  ghost: `${radius.sm} px-4 py-2 text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--paper-warm)] transition-all duration-200 text-sm`,
  accent: `${radius.sm} px-5 py-2.5 bg-[var(--accent)] text-white hover:bg-[var(--accent-light)] transition-all duration-200 font-medium text-sm`,
  icon: `${radius.sm} p-2.5 text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--paper-warm)] transition-all duration-200`,
} as const

// Inputs
export const input = {
  base: `${radius.sm} px-4 py-3 border ${colors.borderMedium} bg-[var(--paper)] text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition-all duration-200`,
  minimal: `bg-transparent border-0 border-b ${colors.borderMedium} rounded-none px-0 py-2 text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:outline-none focus:border-[var(--accent)] transition-all duration-200`,
} as const

// Chips/Tags
export const chip = {
  base: `${radius.sm} px-3 py-1.5 text-xs font-medium`,
  recording: `${radius.sm} px-3 py-1.5 text-xs font-medium ${colors.recordingMuted} ${colors.recording}`,
  capture: `${radius.sm} px-3 py-1.5 text-xs font-medium ${colors.captureMuted} ${colors.capture}`,
  ai: `${radius.sm} px-3 py-1.5 text-xs font-medium ${colors.accentMuted} ${colors.accent}`,
} as const

// ============================================================================
// ANIMATION PRESETS (for Framer Motion)
// ============================================================================

export const animation = {
  // Springs
  springGentle: { type: 'spring', stiffness: 120, damping: 20 },
  springBouncy: { type: 'spring', stiffness: 300, damping: 25 },
  springSnappy: { type: 'spring', stiffness: 400, damping: 30 },

  // Easing (matches CSS variables)
  easeOutExpo: [0.16, 1, 0.3, 1],
  easeInOutExpo: [0.87, 0, 0.13, 1],

  // Common animations
  fadeIn: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: 0.4 },
  },
  slideUp: {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
  },
  slideDown: {
    initial: { opacity: 0, y: -20 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
  },
  scaleIn: {
    initial: { opacity: 0, scale: 0.95 },
    animate: { opacity: 1, scale: 1 },
    transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
  },

  // Stagger children
  stagger: {
    animate: { transition: { staggerChildren: 0.08 } },
  },
  staggerSlow: {
    animate: { transition: { staggerChildren: 0.15 } },
  },
} as const

// ============================================================================
// LAYOUT
// ============================================================================

export const layout = {
  maxWidth: 'max-w-3xl mx-auto',
  maxWidthWide: 'max-w-4xl mx-auto',
  maxWidthNarrow: 'max-w-xl mx-auto',
  fullHeight: 'min-h-screen',
} as const
