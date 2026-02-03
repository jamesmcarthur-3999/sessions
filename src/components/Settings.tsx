import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Key, Sparkles, Check, Eye, EyeOff, Zap, AlertCircle, Brain, CheckSquare, MessageCircle, Link, Mic } from 'lucide-react'
import { updateApiKeys, testApiKey } from '../services/bots'

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
    const savedKey = localStorage.getItem('sessions_api_key')
    const savedOpenaiKey = localStorage.getItem('sessions_openai_api_key')
    if (savedKey) {
      setApiKey(savedKey)
    }
    if (savedOpenaiKey) {
      setOpenaiKey(savedOpenaiKey)
    }
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
      console.error('Failed to save API keys:', error)
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
        console.error('[Settings] API key test failed:', result.error)
        setTestError(result.error || 'Invalid API key')
        setTestStatus('error')
      }
    } catch (error) {
      console.error('[Settings] API key test error:', error)
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
      <header className="sticky top-0 z-10 bg-neutral-50/80 dark:bg-neutral-950/80 backdrop-blur-sm border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center justify-between">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
          <h1 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">
            Settings
          </h1>
          <div className="w-16" />
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-6 py-8">
        {/* Hero */}
        <motion.div variants={itemVariants} className="text-center mb-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
            Power Up with AI
          </h2>
          <p className="text-neutral-500 max-w-md mx-auto">
            Connect your Claude API key to unlock intelligent summaries, task extraction, and smart chat features.
          </p>
        </motion.div>

        {/* API Key Section */}
        <motion.section variants={itemVariants} className="mb-8">
          <div className="p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <Key className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h3 className="font-medium text-neutral-900 dark:text-neutral-100">
                  Claude API Key
                </h3>
                <p className="text-sm text-neutral-500">
                  Get yours at{' '}
                  <a
                    href="https://console.anthropic.com/settings/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-violet-600 dark:text-violet-400 hover:underline"
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
                className="w-full px-4 py-3 pr-12 rounded-xl border border-neutral-200 dark:border-neutral-700
                           bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100
                           placeholder:text-neutral-400 font-mono text-sm
                           focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                aria-label={showKey ? 'Hide API key' : 'Show API key'}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg
                           text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300
                           hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
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
                    ? 'bg-red-600 text-white'
                    : 'bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200'
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
                           border border-neutral-200 dark:border-neutral-700
                           hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {testStatus === 'testing' ? (
                  <>
                    <Zap className="w-4 h-4 animate-pulse" />
                    <span>Testing...</span>
                  </>
                ) : testStatus === 'success' ? (
                  <>
                    <Check className="w-4 h-4 text-green-500" />
                    <span className="text-green-600 dark:text-green-400">Connected!</span>
                  </>
                ) : testStatus === 'error' ? (
                  <>
                    <AlertCircle className="w-4 h-4 text-red-500" />
                    <span className="text-red-600 dark:text-red-400">Failed</span>
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
              <p className="text-sm text-red-600 dark:text-red-400 mt-3">
                {testError}
              </p>
            )}
          </div>
        </motion.section>

        {/* OpenAI API Key Section */}
        <motion.section variants={itemVariants} className="mb-8">
          <div className="p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <Mic className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h3 className="font-medium text-neutral-900 dark:text-neutral-100">
                  OpenAI API Key
                </h3>
                <p className="text-sm text-neutral-500">
                  For audio transcription (Whisper).{' '}
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-violet-600 dark:text-violet-400 hover:underline"
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
                className="w-full px-4 py-3 pr-12 rounded-xl border border-neutral-200 dark:border-neutral-700
                           bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100
                           placeholder:text-neutral-400 font-mono text-sm
                           focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
              <button
                onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                aria-label={showOpenaiKey ? 'Hide API key' : 'Show API key'}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg
                           text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300
                           hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
              >
                {showOpenaiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-neutral-400 mt-2">
              Optional. Only needed for session audio transcription.
            </p>
          </div>
        </motion.section>

        {/* Features Preview */}
        <motion.section variants={itemVariants}>
          <h3 className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider mb-4">
            What You'll Unlock
          </h3>
          <div className="grid gap-3">
            {[
              {
                icon: Brain,
                iconColor: 'text-violet-500',
                bgColor: 'bg-violet-100 dark:bg-violet-900/30',
                title: 'Smart Summaries',
                desc: 'AI-powered analysis of your captures and sessions',
              },
              {
                icon: CheckSquare,
                iconColor: 'text-green-500',
                bgColor: 'bg-green-100 dark:bg-green-900/30',
                title: 'Task Extraction',
                desc: 'Automatically find and organize action items',
              },
              {
                icon: MessageCircle,
                iconColor: 'text-blue-500',
                bgColor: 'bg-blue-100 dark:bg-blue-900/30',
                title: 'Interactive Chat',
                desc: 'Ask questions about your sessions',
              },
              {
                icon: Link,
                iconColor: 'text-amber-500',
                bgColor: 'bg-amber-100 dark:bg-amber-900/30',
                title: 'MCP Integrations',
                desc: 'Connect to Linear, Notion, Slack and more',
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="flex items-center gap-4 p-4 rounded-xl border border-neutral-200 dark:border-neutral-800"
              >
                <div className={`w-10 h-10 rounded-lg ${feature.bgColor} flex items-center justify-center`}>
                  <feature.icon className={`w-5 h-5 ${feature.iconColor}`} />
                </div>
                <div>
                  <h4 className="font-medium text-neutral-900 dark:text-neutral-100">
                    {feature.title}
                  </h4>
                  <p className="text-sm text-neutral-500">{feature.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.section>

        {/* Footer note */}
        <motion.p
          variants={itemVariants}
          className="text-center text-sm text-neutral-400 mt-12"
        >
          Your API keys are stored locally and only sent to their respective API servers.
        </motion.p>
      </main>
    </motion.div>
  )
}
