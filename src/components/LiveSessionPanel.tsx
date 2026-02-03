/**
 * Live Session Panel
 *
 * Shows real-time session intelligence during recording:
 * - Rolling summary (updates as session progresses)
 * - Ephemeral insight cards
 * - Analysis mode indicator
 * - Quick chat input
 */

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Pin,
  X,
  Sun,
  Moon,
  Send,
  Loader2,
  AlertTriangle,
  Settings,
} from 'lucide-react';
import { useSessionIntelligence } from '../hooks/useSessionIntelligence';
import { useSessionChat } from '../hooks/useSessionChat';
import { hasApiKey } from '../services/bots';

interface LiveSessionPanelProps {
  sessionId: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export function LiveSessionPanel({
  sessionId,
  isExpanded,
  onToggleExpand,
}: LiveSessionPanelProps) {
  const {
    summary,
    insights,
    analysisMode,
    setAnalysisMode,
    pinInsight,
  } = useSessionIntelligence(sessionId);

  const {
    messages,
    isSending,
    sendMessage,
  } = useSessionChat(sessionId);

  const [chatInput, setChatInput] = useState('');
  const chatInputRef = useRef<HTMLInputElement>(null);

  // Filter for pinned vs ephemeral insights
  const pinnedInsights = insights.filter(i => i.pinned);
  const recentInsights = insights.filter(i => !i.pinned).slice(0, 3);

  // Check if AI is configured
  const [aiConfigured, setAiConfigured] = useState(false);
  useEffect(() => {
    hasApiKey().then(setAiConfigured);
  }, []);

  // Focus chat input when panel is expanded with keyboard shortcut
  useEffect(() => {
    if (isExpanded && chatInputRef.current) {
      // Small delay to let animation complete
      const timer = setTimeout(() => chatInputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [isExpanded]);

  const handleSendMessage = async () => {
    if (!chatInput.trim() || isSending) return;
    const message = chatInput;
    setChatInput('');
    await sendMessage(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className={`fixed right-0 top-0 h-full bg-[var(--paper)] border-l border-[var(--border-subtle)] shadow-xl flex flex-col transition-all z-40 ${
        isExpanded ? 'w-96' : 'w-80'
      }`}
    >
      {/* Header */}
      <div className="p-4 border-b border-[var(--border-subtle)] flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[var(--accent)]" />
            <span className="font-medium text-lg text-[var(--ink)]">Live Intelligence</span>
          </div>
          <button
            onClick={onToggleExpand}
            className="p-2 rounded-lg hover:bg-[var(--paper-warm)] transition-colors"
            aria-label="Close intelligence panel"
          >
            <X className="w-4 h-4 text-[var(--ink-muted)]" />
          </button>
        </div>

        {/* Analysis Mode Toggle */}
        <div className="mt-3 flex items-center gap-2" role="group" aria-label="Analysis mode selection">
          <button
            onClick={() => setAnalysisMode('ambient')}
            aria-pressed={analysisMode === 'ambient'}
            aria-label="Set analysis mode to ambient (light analysis, less intrusive)"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors ${
              analysisMode === 'ambient'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-[var(--paper-warm)] text-[var(--ink-muted)]'
            }`}
          >
            <Sun className="w-3.5 h-3.5" />
            Ambient
          </button>
          <button
            onClick={() => setAnalysisMode('deep')}
            aria-pressed={analysisMode === 'deep'}
            aria-label="Set analysis mode to deep (full analysis, real-time insights)"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors ${
              analysisMode === 'deep'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-[var(--paper-warm)] text-[var(--ink-muted)]'
            }`}
          >
            <Moon className="w-3.5 h-3.5" />
            Deep
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* AI Not Configured Warning */}
        {!aiConfigured && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-800">
                  AI Features Disabled
                </p>
                <p className="text-xs text-amber-600 mt-1">
                  Add your Claude API key in Settings to enable live summaries, insights, and chat.
                </p>
                <button
                  className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-700 hover:text-amber-900 transition-colors"
                  onClick={() => {
                    // Navigate to settings - this will need to be wired up
                    window.dispatchEvent(new CustomEvent('navigate-to-settings'));
                  }}
                >
                  <Settings className="w-3.5 h-3.5" />
                  Open Settings
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Rolling Summary Card */}
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-4 border-l-4 border-[var(--accent)]">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-[var(--accent)]" />
            <span className="text-xs font-medium text-[var(--accent)] uppercase tracking-wide">
              Rolling Summary
            </span>
          </div>
          <p className="text-sm text-[var(--ink)]/80 leading-relaxed">
            {summary || (aiConfigured
              ? 'Session just started. Summary will appear as you work...'
              : 'Configure API key to enable AI summaries.')}
          </p>
        </div>

        {/* Ephemeral Insights */}
        <AnimatePresence mode="popLayout">
          {recentInsights.map((insight) => (
            <motion.div
              key={insight.id}
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-xl p-3 border border-[var(--border-subtle)] shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-[var(--ink)]/70 flex-1">{insight.content}</p>
                <button
                  onClick={() => pinInsight(insight.id, true)}
                  className="p-1.5 rounded-lg hover:bg-[var(--paper-warm)] transition-colors flex-shrink-0"
                  title="Pin insight"
                  aria-label="Pin insight"
                >
                  <Pin className="w-3.5 h-3.5 text-[var(--ink)]/30" />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Pinned Insights */}
        {pinnedInsights.length > 0 && (
          <div className="space-y-2">
            <span className="text-xs font-medium text-[var(--ink)]/40 uppercase tracking-wide">
              Pinned
            </span>
            {pinnedInsights.map((insight) => (
              <div
                key={insight.id}
                className="bg-white rounded-xl p-3 border border-[var(--accent)]/30 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-[var(--ink)]/70 flex-1">{insight.content}</p>
                  <button
                    onClick={() => pinInsight(insight.id, false)}
                    className="p-1.5 rounded-lg hover:bg-[var(--paper-warm)] transition-colors flex-shrink-0"
                    title="Unpin insight"
                    aria-label="Unpin insight"
                  >
                    <Pin className="w-3.5 h-3.5 text-[var(--accent)]" fill="currentColor" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Recent Chat Messages (if any) */}
        {messages.length > 0 && (
          <div className="space-y-2 mt-4 pt-4 border-t border-[var(--border-subtle)]">
            <span className="text-xs font-medium text-[var(--ink)]/40 uppercase tracking-wide">
              Chat
            </span>
            {messages.slice(-3).map((msg) => (
              <div
                key={msg.id}
                className={`p-2 rounded-lg text-sm ${
                  msg.role === 'user'
                    ? 'bg-[var(--paper-warm)] text-[var(--ink)]'
                    : 'bg-blue-50 text-blue-900'
                }`}
              >
                {msg.content}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Chat Input */}
      {isExpanded && (
        <div className="p-4 border-t border-[var(--border-subtle)] flex-shrink-0">
          <div className="flex items-center gap-2">
            <input
              ref={chatInputRef}
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your session..."
              disabled={isSending}
              className="flex-1 px-3 py-2 rounded-lg bg-[var(--paper-warm)] border border-[var(--border-subtle)] outline-none text-sm focus:border-[var(--accent)] transition-colors disabled:opacity-50"
            />
            <button
              onClick={handleSendMessage}
              disabled={isSending || !chatInput.trim()}
              aria-label={isSending ? 'Sending message...' : 'Send message'}
              className="p-2 rounded-lg bg-[var(--accent)] text-white disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {isSending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}
