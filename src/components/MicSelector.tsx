/**
 * MicSelector
 *
 * Microphone selection dropdown with live audio level meter.
 * Includes "Record without audio" toggle.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff, ChevronDown, Check, AlertCircle } from 'lucide-react'
import { AudioLevelMeter } from './AudioLevelMeter'
import { getAudioDevices, isTauri, type AudioDevice } from '../services/recording'
import { logger } from '../utils/logger'

interface MicSelectorProps {
  /** Selected microphone ID, or null for no audio */
  selectedMicrophone: string | null
  /** Called when selection changes */
  onMicrophoneChange: (deviceId: string | null) => void
  /** Whether the selector is disabled */
  disabled?: boolean
}

export function MicSelector({
  selectedMicrophone,
  onMicrophoneChange,
  disabled,
}: MicSelectorProps) {
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Use refs to avoid callback dependencies causing infinite loops
  const onMicrophoneChangeRef = useRef(onMicrophoneChange)
  const selectedMicrophoneRef = useRef(selectedMicrophone)

  // Keep refs up to date
  useEffect(() => {
    onMicrophoneChangeRef.current = onMicrophoneChange
    selectedMicrophoneRef.current = selectedMicrophone
  })

  // Record without audio toggle
  const isAudioDisabled = selectedMicrophone === null

  // Load audio devices - no callback deps needed since we use refs
  const loadDevices = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      if (isTauri()) {
        const mics = await getAudioDevices()
        setDevices(mics)

        // Auto-select default mic if no selection and audio is enabled
        // Note: initial state is null (no audio), undefined means "unset"
        if (selectedMicrophoneRef.current == null && mics.length > 0) {
          const defaultMic = mics.find(d => d.isDefault) || mics[0]
          onMicrophoneChangeRef.current(defaultMic.id)
        }
      } else {
        // Browser mock
        const mockDevices: AudioDevice[] = [
          { id: 'default', name: 'Default Microphone', isDefault: true },
        ]
        setDevices(mockDevices)

        if (selectedMicrophoneRef.current == null && mockDevices.length > 0) {
          onMicrophoneChangeRef.current(mockDevices[0].id)
        }
      }
    } catch (e) {
      logger.error('Failed to load audio devices:', e)
      setError(e instanceof Error ? e.message : 'Failed to load microphones')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Load devices only once on mount
  useEffect(() => {
    loadDevices()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally run once on mount
  }, [])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Toggle no audio
  const toggleNoAudio = () => {
    if (isAudioDisabled) {
      // Re-enable with default mic
      const defaultMic = devices.find(d => d.isDefault) || devices[0]
      onMicrophoneChange(defaultMic?.id || null)
    } else {
      onMicrophoneChange(null)
    }
  }

  // Select a microphone
  const selectMicrophone = (deviceId: string) => {
    onMicrophoneChange(deviceId)
    setIsDropdownOpen(false)
  }

  const selectedDevice = devices.find(d => d.id === selectedMicrophone)

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-3">
        <h3 className="label-section">Microphone</h3>
        <div className="h-14 rounded-xl bg-[var(--paper-dark)] animate-pulse" />
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-3">
        <h3 className="label-section">Microphone</h3>
        <div className="p-4 rounded-xl bg-[var(--paper-warm)] border border-[var(--border-subtle)]">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-[var(--ink-muted)]" />
            <span className="text-sm text-[var(--ink-muted)]">
              No microphones found
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <h3 className="label-section">Microphone</h3>

      {/* Dropdown selector */}
      <div ref={dropdownRef} className="relative">
        <button
          onClick={() => !disabled && !isAudioDisabled && setIsDropdownOpen(!isDropdownOpen)}
          disabled={disabled || isAudioDisabled}
          className={`
            w-full flex items-center justify-between p-4 rounded-xl
            bg-[var(--paper-warm)] border transition-colors
            ${isAudioDisabled
              ? 'border-[var(--border-subtle)] opacity-50 cursor-not-allowed'
              : isDropdownOpen
                ? 'border-[var(--session-recording)]'
                : 'border-[var(--border-subtle)] hover:border-[var(--border-medium)]'
            }
          `}
          aria-expanded={isDropdownOpen}
          aria-haspopup="listbox"
        >
          <div className="flex items-center gap-3">
            <Mic className={`w-5 h-5 ${isAudioDisabled ? 'text-[var(--ink-muted)]' : 'text-[var(--session-recording)]'}`} />
            <div className="text-left">
              <span className={`text-sm ${isAudioDisabled ? 'text-[var(--ink-muted)]' : 'text-[var(--ink)]'}`}>
                {isAudioDisabled
                  ? 'No audio'
                  : selectedDevice?.name || 'Select microphone'}
              </span>
              {selectedDevice?.isDefault && !isAudioDisabled && (
                <span className="ml-2 text-xs text-[var(--ink-muted)] px-1.5 py-0.5 rounded bg-[var(--paper-dark)]">
                  Default
                </span>
              )}
            </div>
          </div>
          {!isAudioDisabled && (
            <ChevronDown
              className={`w-5 h-5 text-[var(--ink-muted)] transition-transform ${
                isDropdownOpen ? 'rotate-180' : ''
              }`}
            />
          )}
        </button>

        {/* Dropdown menu */}
        <AnimatePresence>
          {isDropdownOpen && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
              className="absolute z-20 w-full mt-2 py-2 rounded-xl bg-[var(--paper)] border border-[var(--border-medium)] shadow-[var(--shadow-lg)]"
              role="listbox"
            >
              {devices.map(device => (
                <button
                  key={device.id}
                  onClick={() => selectMicrophone(device.id)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--paper-warm)] transition-colors text-left"
                  role="option"
                  aria-selected={device.id === selectedMicrophone}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[var(--ink)]">{device.name}</span>
                    {device.isDefault && (
                      <span className="text-xs text-[var(--ink-muted)] px-1.5 py-0.5 rounded bg-[var(--paper-dark)]">
                        Default
                      </span>
                    )}
                  </div>
                  {device.id === selectedMicrophone && (
                    <Check className="w-4 h-4 text-[var(--session-recording)]" />
                  )}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Audio level meter */}
      {!isAudioDisabled && selectedMicrophone && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
        >
          <AudioLevelMeter
            deviceId={selectedMicrophone}
            isActive={!disabled && !isAudioDisabled}
          />
        </motion.div>
      )}

      {/* Record without audio toggle */}
      <label className="flex items-center gap-3 p-3 rounded-lg hover:bg-[var(--paper-warm)] transition-colors cursor-pointer">
        <input
          type="checkbox"
          checked={isAudioDisabled}
          onChange={toggleNoAudio}
          disabled={disabled}
          className="sr-only peer"
        />
        <div className={`
          w-5 h-5 rounded border-2 flex items-center justify-center transition-colors
          ${isAudioDisabled
            ? 'bg-[var(--session-recording)] border-[var(--session-recording)]'
            : 'border-[var(--border-medium)] hover:border-[var(--ink-muted)]'
          }
          peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--session-recording)] peer-focus-visible:ring-offset-2
        `}>
          {isAudioDisabled && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
        </div>
        <div className="flex items-center gap-2">
          <MicOff className="w-4 h-4 text-[var(--ink-muted)]" />
          <span className="text-sm text-[var(--ink)]">Record without audio</span>
        </div>
      </label>
    </div>
  )
}
