/**
 * Transcript Viewer
 *
 * Displays audio transcripts from a session with timestamps.
 */

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Mic, ChevronDown, ChevronUp } from 'lucide-react'
import type { DbAudioChunk } from '../types/database'

interface TranscriptViewerProps {
  audioChunks: DbAudioChunk[]
}

export function TranscriptViewer({ audioChunks }: TranscriptViewerProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  // Filter to only chunks with transcripts
  const transcribedChunks = audioChunks.filter(c => c.transcript)

  if (transcribedChunks.length === 0) {
    return null
  }

  // Combine all transcripts for preview
  const fullTranscript = transcribedChunks.map(c => c.transcript).join(' ')
  const previewLength = 200

  return (
    <div className="rounded-xl bg-[var(--paper-warm)] border border-[var(--border-subtle)] overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-[var(--paper-dark)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--accent-muted)] flex items-center justify-center">
            <Mic className="w-4 h-4 text-[var(--accent)]" />
          </div>
          <div className="text-left">
            <h3 className="font-medium text-[var(--ink)]">Audio Transcript</h3>
            <p className="text-xs text-[var(--ink-muted)]">
              {transcribedChunks.length} segment{transcribedChunks.length !== 1 ? 's' : ''} •
              {Math.round(fullTranscript.split(/\s+/).length)} words
            </p>
          </div>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-5 h-5 text-[var(--ink-muted)]" />
        ) : (
          <ChevronDown className="w-5 h-5 text-[var(--ink-muted)]" />
        )}
      </button>

      {/* Content */}
      <motion.div
        initial={false}
        animate={{ height: isExpanded ? 'auto' : 0 }}
        className="overflow-hidden"
      >
        <div className="p-4 pt-0 space-y-4">
          {isExpanded ? (
            // Full transcript with timestamps
            transcribedChunks.map((chunk) => (
              <div key={chunk.id} className="flex gap-3">
                <div className="flex-shrink-0 text-xs text-[var(--ink-muted)] w-16 pt-0.5">
                  {new Date(chunk.start_time).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </div>
                <p className="text-sm text-[var(--ink)] leading-relaxed">
                  {chunk.transcript}
                </p>
              </div>
            ))
          ) : (
            // Preview
            <p className="text-sm text-[var(--ink-muted)] leading-relaxed">
              {fullTranscript.length > previewLength
                ? fullTranscript.slice(0, previewLength) + '...'
                : fullTranscript}
            </p>
          )}
        </div>
      </motion.div>
    </div>
  )
}
