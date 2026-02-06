import { useState, useRef, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Sparkles, Paperclip, X, Image as ImageIcon, FileText, Feather } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { aiWorker } from '../services/worker/ai-worker-client'
import { persistCaptureAttachments } from '../services/attachments'
import { generateId } from '../utils/id'
import { useToast } from './Toast'
import { ProcessingSpinner } from './ui/ProcessingSpinner'
import { IconBadge } from './ui/IconBadge'
import type { Session, Summary, Attachment } from '../types'
import { logger } from '../utils/logger'

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
      const sessionId = generateId()

      await new Promise(r => setTimeout(r, 500))
      setProcessingStage('Extracting insights...')

      let title: string
      let summary: Summary

      // Build attachment descriptions
      const attachmentDescriptions = attachments.map(f =>
        `${f.type.startsWith('image/') ? 'Image' : 'File'}: ${f.name}`
      )

      // Process capture through the worker (off main thread)
      logger.info('[QuickCapture] Sending capture to worker...')
      const result = await aiWorker.processCapture(text, attachmentDescriptions)
      logger.info('[QuickCapture] Worker result:', result)

      if (result.error) {
        // Worker couldn't process — use fallback
        logger.warn('[QuickCapture] Worker error, using fallback:', result.error)
        const words = text.split(/\s+/).length
        title = words < 10 ? 'Quick Note' : 'Captured Notes'
        summary = {
          text: `Captured ${words} words. Configure your Claude API key in Settings to enable AI-powered analysis.`,
          tasks: [],
          notes: [],
          generatedAt: new Date().toISOString(),
        }
      } else {
        title = result.title ?? 'Quick Note'
        summary = {
          text: result.summary ?? 'Content captured.',
          tasks: (result.tasks ?? []).map((t: string) => ({
            id: generateId(),
            title: t,
            completed: false,
          })),
          notes: (result.notes ?? []).map((n: string) => ({
            id: generateId(),
            content: n,
          })),
          generatedAt: new Date().toISOString(),
        }
      }

      setProcessingStage('Crafting your summary...')
      await new Promise(r => setTimeout(r, 300))

      let attachmentMetadata: Attachment[] = []
      if (attachments.length > 0) {
        setProcessingStage('Saving attachments...')
        attachmentMetadata = await persistCaptureAttachments(sessionId, attachments)
      }

      // Create session
      const session: Session = {
        id: sessionId,
        type: 'capture',
        title,
        createdAt: new Date().toISOString(),
        captureText: text,
        attachments: attachmentMetadata.length > 0 ? attachmentMetadata : undefined,
        summary,
        status: 'complete',
      }

      // Save and navigate
      await addSession(session)
      onComplete(session)
    } catch (error) {
      logger.error('Failed to process capture:', error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      const safeMessage = errorMessage.includes('API key')
        ? 'API key error. Please check your key in Settings.'
        : errorMessage.includes('network') || errorMessage.includes('fetch')
        ? 'Network error. Please check your connection.'
        : 'Capture processing failed. Please try again.'
      showToast(safeMessage, 'error', 8000)
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

  const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB per file
  const MAX_TOTAL_SIZE = 50 * 1024 * 1024 // 50MB total

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        showToast(`${file.name} is too large (${Math.round(file.size / 1024 / 1024)}MB). Max: 25MB.`, 'error')
        return
      }
    }

    const currentTotal = attachments.reduce((sum, f) => sum + f.size, 0)
    const newTotal = currentTotal + files.reduce((sum, f) => sum + f.size, 0)
    if (newTotal > MAX_TOTAL_SIZE) {
      showToast('Total attachment size exceeds 50MB limit.', 'error')
      return
    }

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
            <ProcessingSpinner
              message={processingStage}
              description="AI is analyzing your content"
            />
          </motion.div>
        ) : (
          /* Input state */
          <>
            {/* Writing area */}
            <div className="flex-1 mb-6">
              {/* Icon header */}
              <div className="flex items-center gap-3 mb-6">
                <IconBadge icon={Feather} bg="bg-[var(--session-capture-muted)]" color="text-[var(--session-capture)]" />
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
