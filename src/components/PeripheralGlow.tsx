/**
 * Peripheral Glow
 *
 * Ambient edge glow that communicates session state:
 * - Audio response: brightness/movement with voice
 * - Analysis mode: warm amber (ambient) / cool blue (deep)
 * - Capture heartbeat: golden ripple on screenshot
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

interface PeripheralGlowProps {
  analysisMode: 'ambient' | 'deep';
  audioLevel: number; // 0-1
  onCapture?: boolean; // Flash on capture
}

export function PeripheralGlow({
  analysisMode,
  audioLevel,
  onCapture,
}: PeripheralGlowProps) {
  const [captureFlash, setCaptureFlash] = useState(false);

  // Flash on capture
  useEffect(() => {
    if (onCapture) {
      setCaptureFlash(true);
      const timer = setTimeout(() => setCaptureFlash(false), 300);
      return () => clearTimeout(timer);
    }
  }, [onCapture]);

  // Color based on mode
  const baseColor = analysisMode === 'ambient'
    ? { r: 251, g: 191, b: 36 }  // amber
    : { r: 59, g: 130, b: 246 }; // blue

  // Intensity based on audio (0.05 to 0.25)
  const intensity = 0.05 + (audioLevel * 0.2);

  const colorWithAlpha = (alpha: number) =>
    `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${alpha})`;

  return (
    <>
      {/* Top glow */}
      <div
        className="fixed top-0 left-0 right-0 h-24 pointer-events-none z-30"
        style={{
          background: `linear-gradient(to bottom, ${colorWithAlpha(intensity)}, transparent)`,
          transition: 'background 0.3s ease',
        }}
      />

      {/* Bottom glow */}
      <div
        className="fixed bottom-0 left-0 right-0 h-24 pointer-events-none z-30"
        style={{
          background: `linear-gradient(to top, ${colorWithAlpha(intensity)}, transparent)`,
          transition: 'background 0.3s ease',
        }}
      />

      {/* Left glow */}
      <div
        className="fixed top-0 bottom-0 left-0 w-24 pointer-events-none z-30"
        style={{
          background: `linear-gradient(to right, ${colorWithAlpha(intensity)}, transparent)`,
          transition: 'background 0.3s ease',
        }}
      />

      {/* Right glow */}
      <div
        className="fixed top-0 bottom-0 right-0 w-24 pointer-events-none z-30"
        style={{
          background: `linear-gradient(to left, ${colorWithAlpha(intensity)}, transparent)`,
          transition: 'background 0.3s ease',
        }}
      />

      {/* Capture flash overlay */}
      {captureFlash && (
        <motion.div
          initial={{ opacity: 0.4 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 pointer-events-none z-30"
          style={{
            background: 'radial-gradient(circle at center, rgba(251, 191, 36, 0.25), transparent 70%)',
          }}
        />
      )}

      {/* Audio breathing effect - subtle inner shadow */}
      {audioLevel > 0.1 && (
        <motion.div
          animate={{
            opacity: [0.3, 0.3 + audioLevel * 0.4, 0.3],
          }}
          transition={{
            duration: 0.5,
            repeat: Infinity,
            repeatType: 'reverse',
          }}
          className="fixed inset-0 pointer-events-none z-30"
          style={{
            boxShadow: `inset 0 0 80px ${colorWithAlpha(intensity * 0.5)}`,
          }}
        />
      )}

      {/* Mode indicator dot in corner */}
      <div className="fixed bottom-6 right-6 pointer-events-none z-40">
        <motion.div
          animate={{
            scale: [1, 1.1, 1],
            opacity: [0.6, 0.8, 0.6],
          }}
          transition={{
            duration: analysisMode === 'deep' ? 1 : 2,
            repeat: Infinity,
          }}
          className="w-3 h-3 rounded-full"
          style={{
            backgroundColor: analysisMode === 'ambient' ? 'var(--mode-ambient)' : 'var(--mode-deep)',
            boxShadow: `0 0 10px ${colorWithAlpha(0.5)}`,
          }}
        />
      </div>
    </>
  );
}
