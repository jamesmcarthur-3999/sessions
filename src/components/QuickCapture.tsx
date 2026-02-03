import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Sparkles, Paperclip, X, Image as ImageIcon, FileText, Feather } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { createCaptureBot, buildCaptureInput, initializeBots, isBotsReady } from '../services/bots'
import { generateId } from '../utils/id'
import { useToast } from './Toast'
import type { Session, Summary } from '../types'

interface QuickCaptureProps {
  onBack: () => void
  onComplete: (session: Session) => void
}

export function QuickCapture({ onBack, onComplete }: QuickCaptureProps) {
  const { addSession } = useApp()
  const { showToast } = useToast()
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<File[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingStage, setProcessingStage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Auto-focus textarea
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = Math.min(textarea.scrollHeight, 400) + 'px'
    }
  }, [text])

  const handleSubmit = async () => {
    if (!text.trim() && attachments.length === 0) return

    setIsProcessing(true)
    setProcessingStage('Reading your thoughts...')

    try {
      // Ensure bots are initialized
      await initializeBots()

      await new Promise(r => setTimeout(r, 500))
      setProcessingStage('Extracting insights...')

      let title: string
      let summary: Summary

      if (isBotsReady()) {
        // Use Capture Bot
        const captureBot = createCaptureBot()

        // Build attachment descriptions
        const attachmentDescriptions = attachments.map(f =>
          `${f.type.startsWith('image/') ? 'Image' : 'File'}: ${f.name}`
        )

        const input = buildCaptureInput(text, attachmentDescriptions)
        const result = await captureBot.process(input)

        title = result?.title || 'Quick Note'
        summary = {
          text: result?.summary || 'Content captured.',
          tasks: (result?.tasks || []).map(t => ({
            id: generateId(),
            title: t?.title || 'Untitled task',
            completed: false,
          })),
          notes: (result?.notes || []).map(n => ({
            id: generateId(),
            content: n?.content || '',
          })),
          generatedAt: new Date().toISOString(),
        }
      } else {
        // Fallback when no API key
        const words = text.split(/\s+/).length
        title = words < 10 ? 'Quick Note' : 'Captured Notes'
        summary = {
          text: `Captured ${words} words. Configure your Claude API key in Settings to enable AI-powered analysis.`,
          tasks: [],
          notes: [],
          generatedAt: new Date().toISOString(),
        }
      }

      setProcessingStage('Crafting your summary...')
      await new Promise(r => setTimeout(r, 300))

      // Create session
      const session: Session = {
        id: generateId(),
        type: 'capture',
        title,
        createdAt: new Date().toISOString(),
        captureText: text,
        summary,
      }

      // Save and navigate
      await addSession(session)
      onComplete(session)
    } catch (error) {
      console.error('Failed to process capture:', error)
      showToast('Failed to process capture. Please try again.', 'error', 5000)
      setIsProcessing(false)
      setProcessingStage('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    setAttachments(prev => [...prev, ...files])
  }

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) {
          setAttachments(prev => [...prev, file])
        }
      }
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen flex flex-col bg-[var(--paper)] texture-grain"
    >
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-5 border-b border-[var(--border-subtle)]">
        <button
          onClick={onBack}
          disabled={isProcessing}
          className="flex items-center gap-2 text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors duration-200 disabled:opacity-50"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm">Cancel</span>
        </button>

        <motion.button
          onClick={handleSubmit}
          disabled={isProcessing || (!text.trim() && attachments.length === 0)}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[var(--accent)] text-white font-medium text-sm hover:bg-[var(--accent-light)] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-[var(--shadow-md)]"
        >
          {isProcessing ? (
            <>
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white"
              />
              <span>Processing...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              <span>Capture</span>
            </>
          )}
        </motion.button>
      </header>

      {/* Main content */}
      <div className="flex-1 flex flex-col max-w-3xl mx-auto w-full px-6 py-10">
        {isProcessing ? (
          /* Processing state - Elegant, focused */
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex-1 flex flex-col items-center justify-center"
          >
            {/* Geometric animation */}
            <div className="relative w-28 h-28 mb-10">
              {/* Outer ring */}
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
                className="absolute inset-0"
              >
                <div className="absolute inset-0 rounded-full border border-[var(--accent)]/20" />
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
              </motion.div>

              {/* Middle ring */}
              <motion.div
                animate={{ rotate: -360 }}
                transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
                className="absolute inset-4"
              >
                <div className="absolute inset-0 rounded-full border border-[var(--accent)]/30" />
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-[var(--accent)]" />
              </motion.div>

              {/* Center pulse */}
              <motion.div
                animate={{ scale: [0.8, 1, 0.8], opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute inset-8 rounded-full bg-[var(--accent)]"
              />
            </div>

            <motion.p
              key={processingStage}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="font-display text-xl text-[var(--ink)]"
            >
              {processingStage}
            </motion.p>
            <p className="text-sm text-[var(--ink-muted)] mt-2">
              AI is analyzing your content
            </p>
          </motion.div>
        ) : (
          /* Input state */
          <>
            {/* Writing area */}
            <div className="flex-1 mb-6">
              {/* Icon header */}
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-[var(--session-capture-muted)] flex items-center justify-center">
                  <Feather className="w-5 h-5 text-[var(--session-capture)]" />
                </div>
                <div>
                  <h1 className="font-medium text-[var(--ink)]">Quick Capture</h1>
                  <p className="text-xs text-[var(--ink-muted)]">
                    Write or paste anything, AI will summarize
                  </p>
                </div>
              </div>

              <label htmlFor="quick-capture-input" className="sr-only">Enter your notes, ideas, or content to capture</label>
              <textarea
                id="quick-capture-input"
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="What's on your mind? Paste meeting notes, ideas, tasks..."
                className="w-full min-h-[200px] bg-transparent font-display text-xl leading-relaxed text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:outline-none resize-none"
                disabled={isProcessing}
              />
            </div>

            {/* Attachments */}
            {attachments.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-wrap gap-3 mb-6"
              >
                {attachments.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--paper-warm)] border border-[var(--border-subtle)]"
                  >
                    {file.type.startsWith('image/') ? (
                      <ImageIcon className="w-4 h-4 text-[var(--ink-muted)]" />
                    ) : (
                      <FileText className="w-4 h-4 text-[var(--ink-muted)]" />
                    )}
                    <span className="text-sm text-[var(--ink)] max-w-[150px] truncate">
                      {file.name}
                    </span>
                    <button
                      onClick={() => removeAttachment(index)}
                      className="text-[var(--ink-muted)] hover:text-[var(--error)] transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </motion.div>
            )}

            {/* Bottom toolbar */}
            <div className="pt-6 border-t border-[var(--border-subtle)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,.pdf,.txt,.md"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--paper-warm)] transition-all duration-200"
                >
                  <Paperclip className="w-4 h-4" />
                  <span className="text-sm">Attach</span>
                </button>
              </div>

              <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
                <span className="kbd">⌘</span>
                <span className="kbd">↵</span>
                <span>to capture</span>
              </div>
            </div>
          </>
        )}
      </div>
    </motion.div>
  )
}
