/**
 * Shared Framer Motion animation variants.
 *
 * Used across Home, Settings, History, SessionSetup, LiveDashboard, etc.
 * All use the ease-out-expo curve [0.16, 1, 0.3, 1].
 */

import type { Variants } from 'framer-motion';

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

/**
 * Container variant that staggers children with fade-in.
 * @param stagger - delay between children (default 0.1)
 * @param delay - initial delay before first child (default 0.1)
 */
export function containerVariants(stagger = 0.1, delay = 0.1): Variants {
  return {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: stagger,
        delayChildren: delay,
      },
    },
  };
}

/**
 * Item variant — fades in and slides up.
 * @param y - slide distance in pixels (default 20)
 * @param duration - animation duration (default 0.5)
 */
export function itemVariants(y = 20, duration = 0.5): Variants {
  return {
    hidden: { opacity: 0, y },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration, ease: EASE_OUT_EXPO },
    },
  };
}

/** Preset: simple fade-in (no slide) */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};
