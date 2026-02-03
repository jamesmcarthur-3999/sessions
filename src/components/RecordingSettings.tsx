import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Mic,
  Monitor,
  Camera,
  ChevronDown,
  Check,
  AlertCircle,
  Settings2,
  Zap,
  Sun,
  Moon,
  Sparkles,
} from 'lucide-react'
import { AudioLevelMeter } from './AudioLevelMeter'
import {
  getAudioDevices,
  getScreens,
  isTauri,
  checkScreenRecordingPermission,
  requestScreenRecordingPermission,
  type AudioDevice,
  type ScreenInfo,
} from '../services/recording'

export interface RecordingConfig {
  enableScreenshots: boolean
  enableAudio: boolean
  enableVideo: boolean
  screenshotInterval: number // in minutes
  selectedMicrophone: string | null
  selectedScreen: string | null
  smartCaptureEnabled: boolean
  analysisMode: 'ambient' | 'deep' | 'adaptive'
}

interface RecordingSettingsProps {
  isOpen: boolean
  onClose: () => void
  config: RecordingConfig
  onConfigChange: (config: RecordingConfig) => void
  onStartRecording: () => void
}

const SCREENSHOT_INTERVALS = [
  { value: 0.5, label: '30 seconds' },
  { value: 1, label: '1 minute' },
  { value: 2, label: '2 minutes' },
  { value: 5, label: '5 minutes' },
  { value: 10, label: '10 minutes' },
]

export function RecordingSettings({
  isOpen,
  onClose,
  config,
  onConfigChange,
  onStartRecording,
}: RecordingSettingsProps) {
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([])
  const [screens, setScreens] = useState<ScreenInfo[]>([])
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)
  const [isLoadingDevices, setIsLoadingDevices] = useState(true)
  const [showMicDropdown, setShowMicDropdown] = useState(false)
  const [showScreenDropdown, setShowScreenDropdown] = useState(false)
  const [showIntervalDropdown, setShowIntervalDropdown] = useState(false)

  // Load devices on mount
  useEffect(() => {
    if (!isOpen) return

    async function loadDevices() {
      setIsLoadingDevices(true)

      if (isTauri()) {
        try {
          // Check permissions first
          const permitted = await checkScreenRecordingPermission()
          setHasPermission(permitted)

          // Load devices
          const [mics, displays] = await Promise.all([
            getAudioDevices(),
            getScreens(),
          ])

          setAudioDevices(mics)
          setScreens(displays)

          // Auto-select defaults
          if (!config.selectedMicrophone) {
            const defaultMic = mics.find(d => d.isDefault)
            if (defaultMic) {
              onConfigChange({ ...config, selectedMicrophone: defaultMic.id })
            }
          }

          if (!config.selectedScreen) {
            const primaryScreen = displays.find(s => s.isPrimary)
            if (primaryScreen) {
              onConfigChange({ ...config, selectedScreen: primaryScreen.id })
            }
          }
        } catch (e) {
          console.error('Failed to load devices:', e)
        }
      } else {
        // Browser mode - mock devices
        setAudioDevices([
          { id: 'default', name: 'Default Microphone', isDefault: true },
        ])
        setScreens([
          { id: '0', name: 'Primary Display', width: 1920, height: 1080, x: 0, y: 0, isPrimary: true },
        ])
        setHasPermission(true)
      }

      setIsLoadingDevices(false)
    }

    loadDevices()
  }, [isOpen])

  const handleRequestPermission = async () => {
    const granted = await requestScreenRecordingPermission()
    setHasPermission(granted)
    if (granted) {
      // Reload devices after permission grant
      const [mics, displays] = await Promise.all([
        getAudioDevices(),
        getScreens(),
      ])
      setAudioDevices(mics)
      setScreens(displays)
    }
  }

  const selectedMic = audioDevices.find(d => d.id === config.selectedMicrophone)
  const selectedScreen = screens.find(s => s.id === config.selectedScreen)
  const selectedInterval = SCREENSHOT_INTERVALS.find(i => i.value === config.screenshotInterval)

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md mx-4 bg-[var(--paper)] rounded-2xl border border-[var(--border-subtle)] shadow-[var(--shadow-xl)] overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--border-subtle)]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[var(--session-recording-muted)] flex items-center justify-center">
                <Settings2 className="w-5 h-5 text-[var(--session-recording)]" />
              </div>
              <div>
                <h2 className="font-medium text-[var(--ink)]">Recording Settings</h2>
                <p className="text-xs text-[var(--ink-muted)]">Configure capture options</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-[var(--paper-warm)] transition-colors"
            >
              <X className="w-5 h-5 text-[var(--ink-muted)]" />
            </button>
          </div>

          {/* Content */}
          <div className="px-6 py-6 space-y-6">
            {/* Permission warning */}
            {hasPermission === false && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-3 p-4 rounded-xl bg-[var(--error-muted)] border border-[var(--error)]/20"
              >
                <AlertCircle className="w-5 h-5 text-[var(--error)] flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-[var(--error)]">
                    Screen recording permission required
                  </p>
                  <p className="text-xs text-[var(--error)]/80 mt-1">
                    Grant permission to capture your screen
                  </p>
                  <button
                    onClick={handleRequestPermission}
                    className="mt-3 px-4 py-2 rounded-lg bg-[var(--error)] text-white text-sm font-medium hover:bg-[var(--error)]/80 transition-colors"
                  >
                    Grant Permission
                  </button>
                </div>
              </motion.div>
            )}

            {/* Loading skeleton */}
            {isLoadingDevices && (
              <div className="space-y-4 animate-pulse">
                <div className="h-4 w-24 bg-[var(--paper-dark)] rounded" />
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-16 bg-[var(--paper-dark)] rounded-xl" />
                  ))}
                </div>
                <div className="h-4 w-20 bg-[var(--paper-dark)] rounded" />
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-14 bg-[var(--paper-dark)] rounded-xl" />
                  ))}
                </div>
              </div>
            )}

            {/* Capture toggles */}
            {!isLoadingDevices && (
            <div className="space-y-3">
              <h3 className="label-section">Capture Modes</h3>

              {/* Screenshots toggle */}
              <label className="flex items-center justify-between p-4 rounded-xl bg-[var(--paper-warm)] border border-[var(--border-subtle)] cursor-pointer group">
                <div className="flex items-center gap-3">
                  <Camera className="w-5 h-5 text-[var(--ink-muted)]" />
                  <div>
                    <span className="text-[var(--ink)] font-medium">Screenshots</span>
                    <p className="text-xs text-[var(--ink-muted)]">Capture screen at intervals</p>
                  </div>
                </div>
                <div
                  className={`w-12 h-7 rounded-full transition-colors flex items-center ${
                    config.enableScreenshots ? 'bg-[var(--session-recording)]' : 'bg-[var(--paper-dark)]'
                  }`}
                  onClick={() => onConfigChange({ ...config, enableScreenshots: !config.enableScreenshots })}
                >
                  <motion.div
                    animate={{ x: config.enableScreenshots ? 22 : 2 }}
                    className="w-5 h-5 rounded-full bg-white shadow-sm"
                  />
                </div>
              </label>

              {/* Audio toggle */}
              <label className="flex items-center justify-between p-4 rounded-xl bg-[var(--paper-warm)] border border-[var(--border-subtle)] cursor-pointer">
                <div className="flex items-center gap-3">
                  <Mic className="w-5 h-5 text-[var(--ink-muted)]" />
                  <div>
                    <span className="text-[var(--ink)] font-medium">Audio</span>
                    <p className="text-xs text-[var(--ink-muted)]">Record microphone input</p>
                  </div>
                </div>
                <div
                  className={`w-12 h-7 rounded-full transition-colors flex items-center ${
                    config.enableAudio ? 'bg-[var(--session-recording)]' : 'bg-[var(--paper-dark)]'
                  }`}
                  onClick={() => onConfigChange({ ...config, enableAudio: !config.enableAudio })}
                >
                  <motion.div
                    animate={{ x: config.enableAudio ? 22 : 2 }}
                    className="w-5 h-5 rounded-full bg-white shadow-sm"
                  />
                </div>
              </label>

              {/* Video toggle */}
              <label className="flex items-center justify-between p-4 rounded-xl bg-[var(--paper-warm)] border border-[var(--border-subtle)] cursor-pointer">
                <div className="flex items-center gap-3">
                  <Monitor className="w-5 h-5 text-[var(--ink-muted)]" />
                  <div>
                    <span className="text-[var(--ink)] font-medium">Video</span>
                    <p className="text-xs text-[var(--ink-muted)]">Record screen as video</p>
                  </div>
                </div>
                <div
                  className={`w-12 h-7 rounded-full transition-colors flex items-center ${
                    config.enableVideo ? 'bg-[var(--session-recording)]' : 'bg-[var(--paper-dark)]'
                  }`}
                  onClick={() => onConfigChange({ ...config, enableVideo: !config.enableVideo })}
                >
                  <motion.div
                    animate={{ x: config.enableVideo ? 22 : 2 }}
                    className="w-5 h-5 rounded-full bg-white shadow-sm"
                  />
                </div>
              </label>
            </div>

            {/* Device selection */}
            <div className="space-y-3">
              <h3 className="label-section">Devices</h3>

              {/* Microphone selector */}
              {config.enableAudio && (
                <div className="relative">
                  <button
                    onClick={() => setShowMicDropdown(!showMicDropdown)}
                    className="w-full flex items-center justify-between p-4 rounded-xl bg-[var(--paper-warm)] border border-[var(--border-subtle)] hover:border-[var(--border-medium)] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Mic className="w-5 h-5 text-[var(--ink-muted)]" />
                      <span className="text-[var(--ink)]">
                        {selectedMic?.name || 'Select microphone'}
                      </span>
                    </div>
                    <ChevronDown className={`w-5 h-5 text-[var(--ink-muted)] transition-transform ${showMicDropdown ? 'rotate-180' : ''}`} />
                  </button>

                  <AnimatePresence>
                    {showMicDropdown && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute z-10 w-full mt-2 py-2 rounded-xl bg-[var(--paper)] border border-[var(--border-medium)] shadow-[var(--shadow-lg)]"
                      >
                        {audioDevices.map((device) => (
                          <button
                            key={device.id}
                            onClick={() => {
                              onConfigChange({ ...config, selectedMicrophone: device.id })
                              setShowMicDropdown(false)
                            }}
                            className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--paper-warm)] transition-colors"
                          >
                            <span className="text-[var(--ink)]">{device.name}</span>
                            {device.id === config.selectedMicrophone && (
                              <Check className="w-4 h-4 text-[var(--session-recording)]" />
                            )}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Audio level preview */}
              {config.enableAudio && config.selectedMicrophone && (
                <AudioLevelMeter
                  deviceId={config.selectedMicrophone}
                  isActive={config.enableAudio}
                />
              )}

              {/* Screen selector */}
              {(config.enableScreenshots || config.enableVideo) && screens.length > 1 && (
                <div className="relative">
                  <button
                    onClick={() => setShowScreenDropdown(!showScreenDropdown)}
                    className="w-full flex items-center justify-between p-4 rounded-xl bg-[var(--paper-warm)] border border-[var(--border-subtle)] hover:border-[var(--border-medium)] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Monitor className="w-5 h-5 text-[var(--ink-muted)]" />
                      <span className="text-[var(--ink)]">
                        {selectedScreen ? `${selectedScreen.name} (${selectedScreen.width}×${selectedScreen.height})` : 'Select screen'}
                      </span>
                    </div>
                    <ChevronDown className={`w-5 h-5 text-[var(--ink-muted)] transition-transform ${showScreenDropdown ? 'rotate-180' : ''}`} />
                  </button>

                  <AnimatePresence>
                    {showScreenDropdown && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute z-10 w-full mt-2 py-2 rounded-xl bg-[var(--paper)] border border-[var(--border-medium)] shadow-[var(--shadow-lg)]"
                      >
                        {screens.map((screen) => (
                          <button
                            key={screen.id}
                            onClick={() => {
                              onConfigChange({ ...config, selectedScreen: screen.id })
                              setShowScreenDropdown(false)
                            }}
                            className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--paper-warm)] transition-colors"
                          >
                            <div>
                              <span className="text-[var(--ink)]">{screen.name}</span>
                              <span className="text-xs text-[var(--ink-muted)] ml-2">
                                {screen.width}×{screen.height}
                                {screen.isPrimary && ' (Primary)'}
                              </span>
                            </div>
                            {screen.id === config.selectedScreen && (
                              <Check className="w-4 h-4 text-[var(--session-recording)]" />
                            )}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Screenshot interval */}
              {config.enableScreenshots && (
                <div className="relative">
                  <button
                    onClick={() => setShowIntervalDropdown(!showIntervalDropdown)}
                    className="w-full flex items-center justify-between p-4 rounded-xl bg-[var(--paper-warm)] border border-[var(--border-subtle)] hover:border-[var(--border-medium)] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Camera className="w-5 h-5 text-[var(--ink-muted)]" />
                      <span className="text-[var(--ink)]">
                        Every {selectedInterval?.label || '2 minutes'}
                      </span>
                    </div>
                    <ChevronDown className={`w-5 h-5 text-[var(--ink-muted)] transition-transform ${showIntervalDropdown ? 'rotate-180' : ''}`} />
                  </button>

                  <AnimatePresence>
                    {showIntervalDropdown && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute z-10 w-full mt-2 py-2 rounded-xl bg-[var(--paper)] border border-[var(--border-medium)] shadow-[var(--shadow-lg)]"
                      >
                        {SCREENSHOT_INTERVALS.map((interval) => (
                          <button
                            key={interval.value}
                            onClick={() => {
                              onConfigChange({ ...config, screenshotInterval: interval.value })
                              setShowIntervalDropdown(false)
                            }}
                            className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--paper-warm)] transition-colors"
                          >
                            <span className="text-[var(--ink)]">{interval.label}</span>
                            {interval.value === config.screenshotInterval && (
                              <Check className="w-4 h-4 text-[var(--session-recording)]" />
                            )}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Smart Capture Toggle */}
              {config.enableScreenshots && (
                <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
                  <button
                    onClick={() => onConfigChange({
                      ...config,
                      smartCaptureEnabled: !config.smartCaptureEnabled
                    })}
                    className="w-full flex items-center justify-between p-4 rounded-xl bg-[var(--paper-warm)] border border-[var(--border-subtle)] hover:border-[var(--border-medium)] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        config.smartCaptureEnabled ? 'bg-emerald-100' : 'bg-[var(--paper-dark)]'
                      }`}>
                        <Zap className={`w-4 h-4 ${
                          config.smartCaptureEnabled ? 'text-emerald-600' : 'text-[var(--ink-muted)]'
                        }`} />
                      </div>
                      <div className="text-left">
                        <div className="font-medium text-[var(--ink)]">Smart Capture</div>
                        <div className="text-xs text-[var(--ink-muted)]">
                          Capture on app switches & activity
                        </div>
                      </div>
                    </div>
                    <div
                      className={`w-12 h-7 rounded-full transition-colors flex items-center ${
                        config.smartCaptureEnabled ? 'bg-emerald-500' : 'bg-[var(--paper-dark)]'
                      }`}
                    >
                      <motion.div
                        animate={{ x: config.smartCaptureEnabled ? 22 : 2 }}
                        className="w-5 h-5 rounded-full bg-white shadow-sm"
                      />
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* Analysis Mode */}
            <div className="space-y-3">
              <h3 className="label-section">Analysis Mode</h3>

              <div className="space-y-2">
                <button
                  onClick={() => onConfigChange({ ...config, analysisMode: 'adaptive' })}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                    config.analysisMode === 'adaptive'
                      ? 'border-[var(--session-recording)] bg-[var(--session-recording)]/5'
                      : 'border-[var(--border-subtle)] hover:bg-[var(--paper-warm)]'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    config.analysisMode === 'adaptive' ? 'bg-[var(--session-recording)]/20' : 'bg-[var(--paper-dark)]'
                  }`}>
                    <Sparkles className={`w-4 h-4 ${
                      config.analysisMode === 'adaptive' ? 'text-[var(--session-recording)]' : 'text-[var(--ink-muted)]'
                    }`} />
                  </div>
                  <div className="text-left flex-1">
                    <div className="font-medium text-[var(--ink)]">Adaptive</div>
                    <div className="text-xs text-[var(--ink-muted)]">AI adjusts based on activity</div>
                  </div>
                  {config.analysisMode === 'adaptive' && (
                    <Check className="w-5 h-5 text-[var(--session-recording)]" />
                  )}
                </button>

                <button
                  onClick={() => onConfigChange({ ...config, analysisMode: 'ambient' })}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                    config.analysisMode === 'ambient'
                      ? 'border-amber-400 bg-amber-50'
                      : 'border-[var(--border-subtle)] hover:bg-[var(--paper-warm)]'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    config.analysisMode === 'ambient' ? 'bg-amber-100' : 'bg-[var(--paper-dark)]'
                  }`}>
                    <Sun className={`w-4 h-4 ${
                      config.analysisMode === 'ambient' ? 'text-amber-600' : 'text-[var(--ink-muted)]'
                    }`} />
                  </div>
                  <div className="text-left flex-1">
                    <div className="font-medium text-[var(--ink)]">Ambient</div>
                    <div className="text-xs text-[var(--ink-muted)]">Light analysis, less intrusive</div>
                  </div>
                  {config.analysisMode === 'ambient' && (
                    <Check className="w-5 h-5 text-amber-600" />
                  )}
                </button>

                <button
                  onClick={() => onConfigChange({ ...config, analysisMode: 'deep' })}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                    config.analysisMode === 'deep'
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-[var(--border-subtle)] hover:bg-[var(--paper-warm)]'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    config.analysisMode === 'deep' ? 'bg-blue-100' : 'bg-[var(--paper-dark)]'
                  }`}>
                    <Moon className={`w-4 h-4 ${
                      config.analysisMode === 'deep' ? 'text-blue-600' : 'text-[var(--ink-muted)]'
                    }`} />
                  </div>
                  <div className="text-left flex-1">
                    <div className="font-medium text-[var(--ink)]">Deep</div>
                    <div className="text-xs text-[var(--ink-muted)]">Full analysis, real-time insights</div>
                  </div>
                  {config.analysisMode === 'deep' && (
                    <Check className="w-5 h-5 text-blue-600" />
                  )}
                </button>
              </div>
            </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-5 border-t border-[var(--border-subtle)] flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-lg border border-[var(--border-medium)] text-[var(--ink)] hover:bg-[var(--paper-warm)] transition-colors text-sm"
            >
              Cancel
            </button>
            <motion.button
              onClick={onStartRecording}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              disabled={hasPermission === false}
              className="px-5 py-2.5 rounded-lg bg-[var(--session-recording)] text-white font-medium hover:bg-[var(--session-recording)]/80 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow-[var(--shadow-md)]"
            >
              Start Recording
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// Default config
export const defaultRecordingConfig: RecordingConfig = {
  enableScreenshots: true,
  enableAudio: false,
  enableVideo: false,
  screenshotInterval: 0.5, // 30 seconds
  selectedMicrophone: null,
  selectedScreen: null,
  smartCaptureEnabled: true,
  analysisMode: 'adaptive',
}
