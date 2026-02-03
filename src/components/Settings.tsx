import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Key, Sparkles, Check, Eye, EyeOff, Zap, AlertCircle, Brain, CheckSquare, MessageCircle, Link, Mic } from 'lucide-react'
import { updateApiKeys, testApiKey } from '../services/bots'
import { getSecureItem } from '../services/secure-storage'
import { Tooltip } from './Tooltip'

interface SettingsProps {
  onBack: () => void
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
}

export function Settings({ onBack }: SettingsProps) {
  const [apiKey, setApiKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [showOpenaiKey, setShowOpenaiKey] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [testError, setTestError] = useState<string | null>(null)

  // Load saved API keys on mount
  useEffect(() => {
    async function loadKeys() {
      const savedKey = await getSecureItem('sessions_api_key')
      const savedOpenaiKey = await getSecureItem('sessions_openai_api_key')
      if (savedKey) {
        setApiKey(savedKey)
      }
      if (savedOpenaiKey) {
        setOpenaiKey(savedOpenaiKey)
      }
    }
    loadKeys()
  }, [])

  const handleSave = async () => {
    setIsSaving(true)
    setSaveStatus('idle')

    try {
      // Update bots config with both keys (handles localStorage internally)
      await updateApiKeys({
        claudeApiKey: apiKey.trim() || undefined,
        openaiApiKey: openaiKey.trim() || undefined,
      })

      setSaveStatus('success')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (error) {
      console.error('[Settings] Failed to save configuration')
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
    } finally {
      setIsSaving(false)
    }
  }

  const handleTestConnection = async () => {
    if (!apiKey.trim()) return

    setTestStatus('testing')
    setTestError(null)
    try {
      // Make a real API call to validate the key
      const result = await testApiKey(apiKey.trim())
      if (result.valid) {
        // Key is valid, save it
        await updateApiKeys({ claudeApiKey: apiKey.trim() })
        setTestStatus('success')
      } else {
        console.error('[Settings] Connection test failed')
        setTestError(result.error || 'Invalid API key')
        setTestStatus('error')
      }
    } catch (error) {
      console.error('[Settings] Connection test error')
      setTestError(error instanceof Error ? error.message : 'Connection failed')
      setTestStatus('error')
    }
    setTimeout(() => {
      setTestStatus('idle')
      setTestError(null)
    }, 5000)
  }

  const maskApiKey = (key: string) => {
    if (key.length <= 8) return '•'.repeat(key.length)
    return key.slice(0, 4) + '•'.repeat(key.length - 8) + key.slice(-4)
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="min-h-screen"
    >
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[var(--paper)]/80 backdrop-blur-sm border-b border-[var(--border-subtle)]">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center justify-between">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
          <h1 className="text-lg font-medium text-[var(--ink)]">
            Settings
          </h1>
          <div className="w-16" />
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-6 py-8">
        {/* Hero */}
        <motion.div variants={itemVariants} className="text-center mb-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[var(--accent)] flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-semibold text-[var(--ink)] mb-2">
            Intelligence
          </h2>
          <p className="text-[var(--ink-muted)] max-w-md mx-auto">
            API keys enable summaries, task extraction, and chat.
          </p>
        </motion.div>

        {/* API Key Section */}
        <motion.section variants={itemVariants} className="mb-8">
          <div className="p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--paper)]">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center">
                <Key className="w-5 h-5 text-[var(--accent)]" />
              </div>
              <div>
                <h3 className="font-medium text-[var(--ink)] flex items-center">
                  Claude API Key
                  <Tooltip content="Stored locally. Never sent to our servers." />
                </h3>
                <p className="text-sm text-[var(--ink-muted)]">
                  Get yours at{' '}
                  <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--accent)] hover:underline"
                  >
                    console.anthropic.com
                  </a>
                </p>
              </div>
            </div>

            {/* Input */}
            <div className="relative mb-4">
              <label htmlFor="claude-api-key" className="sr-only">Claude API Key</label>
              <input
                id="claude-api-key"
                type={showKey ? 'text' : 'password'}
                value={showKey ? apiKey : (apiKey ? maskApiKey(apiKey) : '')}
                onChange={(e) => setApiKey(e.target.value)}
                onFocus={() => setShowKey(true)}
                placeholder="sk-ant-api..."
                className="w-full px-4 py-3 pr-12 rounded-xl border border-[var(--border-subtle)]
                           bg-[var(--paper-warm)] text-[var(--ink)]
                           placeholder:text-[var(--ink-muted)] font-mono text-sm
                           focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                aria-label={showKey ? 'Hide API key' : 'Show API key'}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg
                           text-[var(--ink-muted)] hover:text-[var(--ink)]
                           hover:bg-[var(--paper-dark)] transition-colors"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleSave}
                disabled={isSaving}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-colors disabled:opacity-50 ${
                  saveStatus === 'error'
                    ? 'bg-[var(--error)] text-white'
                    : 'bg-[var(--ink)] text-[var(--paper)] hover:opacity-90'
                }`}
              >
                {saveStatus === 'success' ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Saved!</span>
                  </>
                ) : saveStatus === 'error' ? (
                  <>
                    <AlertCircle className="w-4 h-4" />
                    <span>Save Failed</span>
                  </>
                ) : (
                  <span>{isSaving ? 'Saving...' : 'Save Keys'}</span>
                )}
              </button>

              <button
                onClick={handleTestConnection}
                disabled={!apiKey.trim() || testStatus === 'testing'}
                className="flex items-center gap-2 px-4 py-2 rounded-xl
                           border border-[var(--border-subtle)]
                           hover:bg-[var(--paper-warm)] transition-colors
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {testStatus === 'testing' ? (
                  <>
                    <Zap className="w-4 h-4 animate-pulse" />
                    <span>Testing...</span>
                  </>
                ) : testStatus === 'success' ? (
                  <>
                    <Check className="w-4 h-4 text-[var(--success)]" />
                    <span className="text-[var(--success)]">Connected!</span>
                  </>
                ) : testStatus === 'error' ? (
                  <>
                    <AlertCircle className="w-4 h-4 text-[var(--error)]" />
                    <span className="text-[var(--error)]">Failed</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    <span>Test Connection</span>
                  </>
                )}
              </button>
            </div>

            {/* Test error message */}
            {testError && (
              <p className="text-sm text-[var(--error)] mt-3">
                {testError}
              </p>
            )}
          </div>
        </motion.section>

        {/* OpenAI API Key Section */}
        <motion.section variants={itemVariants} className="mb-8">
          <div className="p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--paper)]">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-[var(--success)]/10 flex items-center justify-center">
                <Mic className="w-5 h-5 text-[var(--success)]" />
              </div>
              <div>
                <h3 className="font-medium text-[var(--ink)] flex items-center">
                  OpenAI API Key
                  <Tooltip content="Stored locally. Used only for audio transcription." />
                </h3>
                <p className="text-sm text-[var(--ink-muted)]">
                  For audio transcription (Whisper).{' '}
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--accent)] hover:underline"
                  >
                    Get key
                  </a>
                </p>
              </div>
            </div>

            {/* Input */}
            <div className="relative">
              <label htmlFor="openai-api-key" className="sr-only">OpenAI API Key</label>
              <input
                id="openai-api-key"
                type={showOpenaiKey ? 'text' : 'password'}
                value={showOpenaiKey ? openaiKey : (openaiKey ? maskApiKey(openaiKey) : '')}
                onChange={(e) => setOpenaiKey(e.target.value)}
                onFocus={() => setShowOpenaiKey(true)}
                placeholder="sk-..."
                className="w-full px-4 py-3 pr-12 rounded-xl border border-[var(--border-subtle)]
                           bg-[var(--paper-warm)] text-[var(--ink)]
                           placeholder:text-[var(--ink-muted)] font-mono text-sm
                           focus:outline-none focus:ring-2 focus:ring-[var(--success)] focus:border-transparent"
              />
              <button
                onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                aria-label={showOpenaiKey ? 'Hide API key' : 'Show API key'}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg
                           text-[var(--ink-muted)] hover:text-[var(--ink)]
                           hover:bg-[var(--paper-dark)] transition-colors"
              >
                {showOpenaiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-[var(--ink-muted)] mt-2">
              Optional. Only needed for session audio transcription.
            </p>
          </div>
        </motion.section>

        {/* Features Preview */}
        <motion.section variants={itemVariants}>
          <h3 className="text-xs font-semibold text-[var(--ink-muted)] uppercase tracking-wider mb-4">
            Capabilities
          </h3>
          <div className="grid gap-3">
            {[
              {
                icon: Brain,
                iconColor: 'text-[var(--accent)]',
                bgColor: 'bg-[var(--accent)]/10',
                title: 'Smart Summaries',
                desc: 'AI-powered analysis of your captures and sessions',
              },
              {
                icon: CheckSquare,
                iconColor: 'text-[var(--success)]',
                bgColor: 'bg-[var(--success)]/10',
                title: 'Task Extraction',
                desc: 'Automatically find and organize action items',
              },
              {
                icon: MessageCircle,
                iconColor: 'text-[var(--session-capture)]',
                bgColor: 'bg-[var(--session-capture)]/10',
                title: 'Interactive Chat',
                desc: 'Ask questions about your sessions',
              },
              {
                icon: Link,
                iconColor: 'text-[var(--accent)]',
                bgColor: 'bg-[var(--accent)]/10',
                title: 'MCP Integrations',
                desc: 'Connect to Linear, Notion, Slack and more',
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="flex items-center gap-4 p-4 rounded-xl border border-[var(--border-subtle)]"
              >
                <div className={`w-10 h-10 rounded-lg ${feature.bgColor} flex items-center justify-center`}>
                  <feature.icon className={`w-5 h-5 ${feature.iconColor}`} />
                </div>
                <div>
                  <h4 className="font-medium text-[var(--ink)]">
                    {feature.title}
                  </h4>
                  <p className="text-sm text-[var(--ink-muted)]">{feature.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.section>

        {/* Footer note */}
        <motion.p
          variants={itemVariants}
          className="text-center text-sm text-[var(--ink-muted)] mt-12"
        >
          Your API keys are stored locally and only sent to their respective API servers.
        </motion.p>
      </main>
    </motion.div>
  )
}
