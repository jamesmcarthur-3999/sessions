/**
 * AudioLevelMeter
 *
 * Real-time visualization of microphone input level.
 * Shows if microphone is working before starting recording.
 */

import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Mic, MicOff, AlertTriangle } from 'lucide-react'
import { logger } from '../utils/logger'

interface AudioLevelMeterProps {
  deviceId: string | null
  isActive: boolean
}

export function AudioLevelMeter({ deviceId, isActive }: AudioLevelMeterProps) {
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [isListening, setIsListening] = useState(false)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animationRef = useRef<number | null>(null)

  useEffect(() => {
    if (!isActive) {
      cleanup()
      setLevel(0)
      setIsListening(false)
      return
    }

    let isMounted = true

    async function startListening() {
      try {
        setError(null)
        setIsListening(false)

        // The deviceId prop comes from Tauri (device name as stable ID)
        // We need to find the matching Web API device by label
        let webDeviceId: string | undefined

        if (deviceId) {
          try {
            // Try to enumerate devices first - if we already have permission, this will work
            // without needing an extra getUserMedia call
            let webDevices = await navigator.mediaDevices.enumerateDevices()
            let audioInputs = webDevices.filter(d => d.kind === 'audioinput')

            // If labels are empty, we need permission first
            if (audioInputs.length > 0 && !audioInputs[0].label) {
              // Request permission to get device labels, then re-enumerate
              const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
              tempStream.getTracks().forEach(t => t.stop())
              webDevices = await navigator.mediaDevices.enumerateDevices()
              audioInputs = webDevices.filter(d => d.kind === 'audioinput')
            }

            // Try to find matching device by label (Tauri uses device name as ID)
            const matchingDevice = audioInputs.find(d =>
              d.label === deviceId || d.label.includes(deviceId) || deviceId.includes(d.label)
            )

            if (matchingDevice) {
              webDeviceId = matchingDevice.deviceId
            }
          } catch {
            // If enumeration fails, fall back to default device
            logger.warn('[AudioLevelMeter] Could not enumerate devices, using default')
          }
        }

        // Get audio stream for level monitoring
        const constraints: MediaStreamConstraints = {
          audio: webDeviceId ? { deviceId: { exact: webDeviceId } } : true,
          video: false,
        }

        const stream = await navigator.mediaDevices.getUserMedia(constraints)

        // Check if still mounted after async operation
        if (!isMounted) {
          stream.getTracks().forEach(track => track.stop())
          return
        }

        streamRef.current = stream

        // Create audio context and analyser
        const audioContext = new AudioContext()
        if (!isMounted) {
          audioContext.close()
          stream.getTracks().forEach(track => track.stop())
          return
        }
        audioContextRef.current = audioContext

        const analyser = audioContext.createAnalyser()
        analyser.fftSize = 256
        analyserRef.current = analyser

        const source = audioContext.createMediaStreamSource(stream)
        source.connect(analyser)

        setIsListening(true)

        // Start level monitoring - throttled to 10fps for performance
        const dataArray = new Uint8Array(analyser.frequencyBinCount)

        function updateLevel() {
          if (!isMounted || !analyserRef.current) return

          analyserRef.current.getByteFrequencyData(dataArray)

          // Calculate RMS level
          let sum = 0
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i] * dataArray[i]
          }
          const rms = Math.sqrt(sum / dataArray.length)
          const normalizedLevel = Math.min(rms / 128, 1) // Normalize to 0-1

          setLevel(normalizedLevel)
        }

        // Update 10 times per second instead of 60fps
        updateLevel()
        animationRef.current = setInterval(updateLevel, 100) as unknown as number
      } catch (err) {
        if (!isMounted) return
        logger.error('Failed to access microphone:', err)
        setError(err instanceof Error ? err.message : 'Microphone access denied')
        setIsListening(false)
      }
    }

    startListening()

    return () => {
      isMounted = false
      cleanup()
    }
  }, [isActive, deviceId])

  function cleanup() {
    if (animationRef.current) {
      clearInterval(animationRef.current)
      animationRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    analyserRef.current = null
  }

  if (!isActive) return null

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--error-muted)] text-[var(--error)]">
        <MicOff className="w-4 h-4" />
        <span className="text-xs">Mic unavailable</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--paper-dark)]">
      <Mic className={`w-4 h-4 ${isListening ? 'text-[var(--success)]' : 'text-[var(--ink-muted)]'}`} />

      {/* Level bars */}
      <div className="flex items-center gap-0.5 h-4">
        {Array.from({ length: 10 }).map((_, i) => {
          const threshold = (i + 1) / 10
          const isBarActive = level >= threshold
          const isHigh = threshold > 0.8

          return (
            <motion.div
              key={i}
              className={`w-1 rounded-full transition-colors ${
                isBarActive
                  ? isHigh
                    ? 'bg-[var(--error)]'
                    : 'bg-[var(--success)]'
                  : 'bg-[var(--paper-warm)]'
              }`}
              animate={{
                height: isBarActive ? `${12 + i * 0.5}px` : '4px',
              }}
              transition={{ duration: 0.05 }}
            />
          )
        })}
      </div>

      {/* Status text */}
      <span className="text-xs text-[var(--ink-muted)]">
        {isListening ? (level > 0.1 ? 'Receiving audio' : 'Listening...') : 'Connecting...'}
      </span>

      {/* Clipping warning */}
      {level > 0.9 && (
        <AlertTriangle className="w-3 h-3 text-[var(--error)]" />
      )}
    </div>
  )
}
