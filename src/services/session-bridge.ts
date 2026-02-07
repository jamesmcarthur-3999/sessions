/**
 * Session Bridge
 *
 * Lightweight bridge between the AI Worker and the rest of the application.
 * Handles:
 * - Persisting worker results to the database
 * - Forwarding events to UI components
 * - Managing session lifecycle
 *
 * Does NOT run any AI operations directly — they all happen in the worker.
 */

import {
  aiWorker,
  type WorkerSessionContext,
  type WorkerActivityMetrics,
} from './worker';
import { EventEmitter } from './event-emitter';
import {
  getSession,
  getScreenshots,
  getAudioChunks,
  getInsights,
  getRollingSummary,
  updateRollingSummary,
  createInsight,
  updateAnalysisMode,
  updateScreenshotAnalysis,
  saveChatMessage,
  saveLiveTranscript,
} from './database';
import type { DbInsight } from '../types/database';
import { logger } from '../utils/logger';

// ============================================================================
// Events (same shape as CoordinatorEvents for compatibility)
// ============================================================================

export type SessionBridgeEvents = {
  'summary-updated': { sessionId: string; summary: string };
  'insight-created': { sessionId: string; type: string; content: string };
  'mode-changed': { sessionId: string; mode: 'ambient' | 'deep'; reason: string };
  'activity-detected': {
    sessionId: string;
    activity: {
      hasSignificantChange: boolean;
      currentApp: string | null;
      currentContext: string;
      activityType: string;
      suggestedInsight: string | null;
    };
  };
  'capture-timing': {
    sessionId: string;
    recommendedWaitMs: number;
    activityLevel: string;
    reason: string;
  };
  'chat-response': { sessionId: string; message: string };
  'error': { sessionId: string; error: string };
  'live-transcript': {
    sessionId: string;
    text: string;
    isFinal: boolean;
    confidence?: number;
  };
  'recording-error': { sessionId: string; error: string };
  'live-speech-started': { sessionId: string };
  'live-speech-ended': { sessionId: string };
  'topic-change': { sessionId: string; topic: string };
  'title-suggestion': { sessionId: string; title: string };
};

type EventCallback<K extends keyof SessionBridgeEvents> = (data: SessionBridgeEvents[K]) => void;

// ============================================================================
// Session Bridge Service
// ============================================================================

class SessionBridgeService {
  private emitter = new EventEmitter<SessionBridgeEvents>();
  private activeSessions = new Set<string>();
  private pausedSessions = new Set<string>();
  private summaryUpdateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private analysisCheckTimers = new Map<string, ReturnType<typeof setInterval>>();
  private unsubscribers: Array<() => void> = [];

  // In-flight operation tracking (fixes D1)
  private inflightOps = new Map<string, Set<string>>();
  // Guard against duplicate listener setup
  private listenersSetUp = false;

  // Session Narrator state
  private narratorTranscriptBuffer = new Map<string, string[]>();
  private narratorPreviousTopic = new Map<string, string>();

  // Prevent concurrent session starts
  private isStarting = false;

  constructor() {
    this.setupWorkerListeners();
  }

  /**
   * Subscribe to session bridge events
   */
  on<K extends keyof SessionBridgeEvents>(event: K, callback: EventCallback<K>): () => void {
    return this.emitter.on(event, callback);
  }

  /**
   * Emit an event on the session bridge (for external services like recording.ts)
   */
  emit<K extends keyof SessionBridgeEvents>(event: K, data: SessionBridgeEvents[K]): void {
    this.emitter.emit(event, data);
  }

  /**
   * Start managing a session
   */
  async startSession(sessionId: string): Promise<void> {
    if (this.activeSessions.has(sessionId)) {
      logger.warn('[SESSION BRIDGE] Session already active:', sessionId);
      return;
    }

    if (this.isStarting) {
      logger.warn('[SESSION BRIDGE] Another session is starting, ignoring:', sessionId);
      return;
    }

    this.isStarting = true;
    try {
      this.activeSessions.add(sessionId);
      this.inflightOps.set(sessionId, new Set());

      // Proactive worker init (fixes D3)
      try {
        await aiWorker.initialize();
        logger.info('[SESSION BRIDGE] Worker initialized proactively');
      } catch (error) {
        logger.warn('[SESSION BRIDGE] Proactive worker init failed:', error);
        // Continue anyway - will try again on first use
      }

      // Clear any stale timer for this session before creating new one
      const existingAnalysisTimer = this.analysisCheckTimers.get(sessionId);
      if (existingAnalysisTimer) {
        clearInterval(existingAnalysisTimer);
      }
      const existingSummaryTimer = this.summaryUpdateTimers.get(sessionId);
      if (existingSummaryTimer) {
        clearTimeout(existingSummaryTimer);
        this.summaryUpdateTimers.delete(sessionId);
      }

      // Set up periodic analysis mode check (every 2 minutes)
      const analysisInterval = setInterval(() => {
        this.checkAnalysisMode(sessionId).catch(logger.error);
      }, 120000);
      this.analysisCheckTimers.set(sessionId, analysisInterval);

      logger.info('[SESSION BRIDGE] Started for session:', sessionId);
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * Stop managing a session
   * Waits for tracked in-flight operations to complete (max 5 seconds)
   *
   * NOTE: Audio transcription and screenshot analysis initiated from recording.ts
   * and smart-capture.ts go directly to aiWorker and are NOT tracked here.
   * This is acceptable because:
   * 1. Audio/screenshot data is saved to DB before analysis starts
   * 2. Analysis results update DB when complete (handled by worker event listeners)
   * 3. UI updates work regardless of session state
   */
  async stopSession(sessionId: string): Promise<void> {
    // Run narrator one last time if there's buffered content.
    // Await with timeout so the result arrives while session is still active.
    const remainingBuffer = this.narratorTranscriptBuffer.get(sessionId);
    if (remainingBuffer && remainingBuffer.length > 0) {
      try {
        const session = await getSession(sessionId);
        await Promise.race([
          aiWorker.narrateSession(
            sessionId,
            remainingBuffer,
            session?.title || '',
            this.narratorPreviousTopic.get(sessionId) || null,
          ),
          new Promise((r) => setTimeout(r, 5000)), // 5s max wait for final narration (API round-trip)
        ]);
      } catch {
        // Best effort final flush
      }
    }
    this.narratorTranscriptBuffer.delete(sessionId);
    this.narratorPreviousTopic.delete(sessionId);

    // Wait for tracked in-flight operations
    const inflight = this.inflightOps.get(sessionId);
    if (inflight && inflight.size > 0) {
      logger.debug(
        `[SESSION BRIDGE] Waiting for ${inflight.size} tracked in-flight operations...`
      );
      await Promise.race([
        this.waitForInflight(sessionId),
        new Promise((r) => setTimeout(r, 5000)), // 5s max wait
      ]);
      logger.debug('[SESSION BRIDGE] In-flight operations completed or timed out');
    }

    this.activeSessions.delete(sessionId);
    this.pausedSessions.delete(sessionId);
    this.inflightOps.delete(sessionId);

    // Clear timers
    const summaryTimer = this.summaryUpdateTimers.get(sessionId);
    if (summaryTimer) {
      clearTimeout(summaryTimer);
      this.summaryUpdateTimers.delete(sessionId);
    }

    const analysisTimer = this.analysisCheckTimers.get(sessionId);
    if (analysisTimer) {
      clearInterval(analysisTimer);
      this.analysisCheckTimers.delete(sessionId);
    }

    logger.info('[SESSION BRIDGE] Stopped for session:', sessionId);
  }

  /**
   * Wait for all in-flight operations for a session
   */
  private async waitForInflight(sessionId: string): Promise<void> {
    const inflight = this.inflightOps.get(sessionId);
    if (!inflight || inflight.size === 0) return;

    // Poll until empty or timeout
    const start = Date.now();
    while (inflight.size > 0 && Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /**
   * Complete an in-flight operation
   */
  private completeInflightOp(sessionId: string, requestId: string): void {
    const ops = this.inflightOps.get(sessionId);
    if (ops) {
      ops.delete(requestId);
    }
  }

  /**
   * Pause AI analysis for a session (saves API credits)
   */
  pauseSession(sessionId: string): void {
    this.pausedSessions.add(sessionId);
    logger.info('[SESSION BRIDGE] Session paused:', sessionId);
  }

  /**
   * Resume AI analysis for a session
   */
  resumeSession(sessionId: string): void {
    this.pausedSessions.delete(sessionId);
    logger.info('[SESSION BRIDGE] Session resumed:', sessionId);
  }

  /**
   * Check if session is paused
   */
  isSessionPaused(sessionId: string): boolean {
    return this.pausedSessions.has(sessionId);
  }

  /**
   * Handle chat message
   */
  async handleChatMessage(sessionId: string, message: string): Promise<string> {
    // Save user message
    await saveChatMessage(sessionId, 'user', message);

    // Build context and send to worker
    const context = await this.buildContext(sessionId);

    // Get response from worker (this is the only blocking call)
    const response = await aiWorker.chat(sessionId, message, context);

    // Save assistant response
    await saveChatMessage(sessionId, 'assistant', response);

    // Emit event
    this.emitter.emit('chat-response', { sessionId, message: response });

    return response;
  }

  /**
   * Manually set analysis mode
   */
  async setAnalysisMode(sessionId: string, mode: 'ambient' | 'deep'): Promise<void> {
    await updateAnalysisMode(sessionId, mode);
    await aiWorker.setAnalysisMode(sessionId, mode);
    this.emitter.emit('mode-changed', { sessionId, mode, reason: 'Manual override' });
  }

  // ============================================================================
  // Private: Worker Event Handlers
  // ============================================================================

  private setupWorkerListeners(): void {
    if (this.listenersSetUp) return;
    this.listenersSetUp = true;

    // Analysis complete - persist and forward
    const unsubAnalysis = aiWorker.on('analysis-complete', async (data) => {
      if (!this.activeSessions.has(data.sessionId)) return;

      // Complete in-flight tracking
      if (data.screenshotId) {
        this.completeInflightOp(data.sessionId, data.screenshotId);
      }

      // Check pause state (fixes D2)
      if (this.pausedSessions.has(data.sessionId)) {
        logger.debug('[SESSION BRIDGE] Skipping analysis persist (paused)');
        return;
      }

      try {
        if (data.analysis) {
          // Update screenshot with analysis
          await updateScreenshotAnalysis(
            data.screenshotId,
            data.analysis.currentContext || 'Analysis unavailable'
          );

          // Forward to UI
          this.emitter.emit('activity-detected', {
            sessionId: data.sessionId,
            activity: {
              hasSignificantChange: data.analysis.hasSignificantChange,
              currentApp: data.analysis.currentApp,
              currentContext: data.analysis.currentContext,
              activityType: data.analysis.activityType,
              suggestedInsight: data.analysis.suggestedInsight,
            },
          });
        } else if (data.error) {
          // Update screenshot with error
          await updateScreenshotAnalysis(data.screenshotId, `Analysis failed: ${data.error}`);
          this.emitter.emit('error', { sessionId: data.sessionId, error: data.error });
        }
      } catch (error) {
        logger.error('[SESSION BRIDGE] Failed to persist analysis:', error);
        this.emitter.emit('error', {
          sessionId: data.sessionId,
          error: 'Failed to save analysis',
        });
      }
    });

    // Insight created - persist and forward
    const unsubInsight = aiWorker.on('insight-created', async (data) => {
      if (!this.activeSessions.has(data.sessionId)) return;

      // Check pause state (fixes D2)
      if (this.pausedSessions.has(data.sessionId)) {
        logger.debug('[SESSION BRIDGE] Skipping insight persist (paused)');
        return;
      }

      try {
        await createInsight(
          data.sessionId,
          data.insightType as DbInsight['type'],
          data.content
        );
        this.emitter.emit('insight-created', {
          sessionId: data.sessionId,
          type: data.insightType,
          content: data.content,
        });
      } catch (error) {
        logger.error('[SESSION BRIDGE] Failed to persist insight:', error);
      }
    });

    // Summary updated - persist and forward
    const unsubSummary = aiWorker.on('summary-updated', async (data) => {
      if (!this.activeSessions.has(data.sessionId)) return;

      // Check pause state (fixes D2)
      if (this.pausedSessions.has(data.sessionId)) {
        logger.debug('[SESSION BRIDGE] Skipping summary persist (paused)');
        return;
      }

      try {
        await updateRollingSummary(data.sessionId, data.summary);
        this.emitter.emit('summary-updated', {
          sessionId: data.sessionId,
          summary: data.summary,
        });
      } catch (error) {
        logger.error('[SESSION BRIDGE] Failed to persist summary:', error);
      }
    });

    // Request summary update - trigger worker
    const unsubSummaryRequest = aiWorker.on('request-summary-update', async (data) => {
      if (!this.activeSessions.has(data.sessionId)) return;
      if (this.pausedSessions.has(data.sessionId)) return;

      // Debounce summary updates (5 second delay)
      const existing = this.summaryUpdateTimers.get(data.sessionId);
      if (existing) {
        clearTimeout(existing);
      }

      const timer = setTimeout(async () => {
        this.summaryUpdateTimers.delete(data.sessionId);

        // Double-check pause state before triggering
        if (this.pausedSessions.has(data.sessionId)) return;

        try {
          const context = await this.buildContext(data.sessionId);
          await aiWorker.updateSummary(data.sessionId, context);
        } catch (error) {
          logger.error('[SESSION BRIDGE] Failed to trigger summary update:', error);
        }
      }, 5000);

      this.summaryUpdateTimers.set(data.sessionId, timer);
    });

    // Mode changed - persist and forward
    const unsubMode = aiWorker.on('mode-changed', async (data) => {
      if (!this.activeSessions.has(data.sessionId)) return;

      // Check pause state (fixes D2)
      if (this.pausedSessions.has(data.sessionId)) {
        logger.debug('[SESSION BRIDGE] Skipping mode change persist (paused)');
        return;
      }

      try {
        await updateAnalysisMode(data.sessionId, data.mode);
        this.emitter.emit('mode-changed', data);
      } catch (error) {
        logger.error('[SESSION BRIDGE] Failed to persist mode change:', error);
      }
    });

    // Capture timing - forward directly
    const unsubTiming = aiWorker.on('capture-timing', (data) => {
      if (!this.activeSessions.has(data.sessionId)) return;
      this.emitter.emit('capture-timing', data);
    });

    // Live transcript events - persist finals, forward all to UI
    const unsubLiveTranscript = aiWorker.on('live-transcript', async (data) => {
      if (!this.activeSessions.has(data.sessionId)) return;

      // Forward all events to UI (including interim results)
      this.emitter.emit('live-transcript', {
        sessionId: data.sessionId,
        text: data.text,
        isFinal: data.isFinal,
        confidence: data.confidence,
      });

      // Only persist final transcripts to database
      if (data.isFinal && data.text.trim()) {
        try {
          // INSERT a new row for live transcripts (they don't correspond to a WAV chunk)
          await saveLiveTranscript(data.sessionId, `live_${Date.now()}`, data.text);
        } catch (error) {
          logger.error('[SESSION BRIDGE] Failed to persist live transcript:', error);
        }

        // Buffer for Session Narrator
        this.bufferTranscriptForNarrator(data.sessionId, data.text);
      }
    });

    const unsubLiveSpeechStarted = aiWorker.on('live-speech-started', (data) => {
      if (!this.activeSessions.has(data.sessionId)) return;
      this.emitter.emit('live-speech-started', data);
    });

    const unsubLiveSpeechEnded = aiWorker.on('live-speech-ended', (data) => {
      if (!this.activeSessions.has(data.sessionId)) return;
      this.emitter.emit('live-speech-ended', data);
    });

    // Narrator update - forward title suggestions, topic changes, and key points
    const unsubNarrator = aiWorker.on('narrator-update', async (data) => {
      if (!this.activeSessions.has(data.sessionId)) return;
      if (this.pausedSessions.has(data.sessionId)) return;

      // Update tracked topic
      this.narratorPreviousTopic.set(data.sessionId, data.currentTopic);

      // Title suggestion → emit event for UI hook to pick up
      if (data.suggestedTitle) {
        this.emitter.emit('title-suggestion', {
          sessionId: data.sessionId,
          title: data.suggestedTitle,
        });
      }

      // Topic change → activity feed event
      if (data.isTopicChange) {
        this.emitter.emit('topic-change', {
          sessionId: data.sessionId,
          topic: data.currentTopic,
        });
      }

      // Key points → create as insights (feeds existing InsightsPanel + summary bot)
      for (const point of data.keyPoints) {
        try {
          await createInsight(data.sessionId, 'key-insight', point);
          this.emitter.emit('insight-created', {
            sessionId: data.sessionId,
            type: 'key-insight',
            content: point,
          });
        } catch (error) {
          logger.error('[SESSION BRIDGE] Failed to create narrator insight:', error);
        }
      }
    });

    // State changes - log for debugging
    const unsubStateChange = aiWorker.on('state-change', (data) => {
      logger.debug(
        `[SESSION BRIDGE] Worker state: ${data.from} -> ${data.to}`,
        data.reason ? `(${data.reason})` : ''
      );
    });

    // Errors - forward directly
    const unsubError = aiWorker.on('error', (data) => {
      this.emitter.emit('error', data);
    });

    this.unsubscribers = [
      unsubAnalysis,
      unsubInsight,
      unsubSummary,
      unsubSummaryRequest,
      unsubMode,
      unsubTiming,
      unsubLiveTranscript,
      unsubLiveSpeechStarted,
      unsubLiveSpeechEnded,
      unsubNarrator,
      unsubStateChange,
      unsubError,
    ];
  }

  // ============================================================================
  // Private: Context Building
  // ============================================================================

  private async buildContext(sessionId: string): Promise<WorkerSessionContext> {
    const [session, screenshots, audioChunks, insights, summary] = await Promise.all([
      getSession(sessionId),
      getScreenshots(sessionId, 10),
      getAudioChunks(sessionId),
      getInsights(sessionId),
      getRollingSummary(sessionId),
    ]);

    if (!session) throw new Error(`Session not found: ${sessionId}`);

    return {
      sessionId,
      rollingSummary: summary?.content || '',
      recentScreenshots: screenshots.map((s) => ({
        id: s.id,
        capturedAt: s.captured_at,
        appName: s.app_name,
        windowTitle: s.window_title,
        analysis: s.analysis,
      })),
      recentTranscripts: audioChunks
        .filter((c) => c.transcript)
        .slice(-5)
        .map((c) => c.transcript!),
      recentInsights: insights.slice(-10).map((i) => i.content),
      durationSeconds: session.duration_seconds || 0,
      analysisMode: session.analysis_mode === 'deep' ? 'deep' : 'ambient',
    };
  }

  private async checkAnalysisMode(sessionId: string): Promise<void> {
    if (!this.activeSessions.has(sessionId)) return;
    if (this.pausedSessions.has(sessionId)) return;

    try {
      const context = await this.buildContext(sessionId);

      // Compute metrics from context
      const screenshots = context.recentScreenshots;
      const apps = new Set(screenshots.map((s) => s.appName).filter(Boolean));
      const wordCount = context.recentTranscripts
        .join(' ')
        .split(/\s+/)
        .filter((w) => w.length > 0).length;

      const metrics: WorkerActivityMetrics = {
        appSwitchCount: screenshots.length > 1 ? screenshots.length - 1 : 0, // Rough estimate
        uniqueAppsCount: apps.size,
        screenshotCount: screenshots.length,
        audioWordCount: wordCount,
        averageScreenshotChangeMagnitude: 0.5,
        timeSinceLastActivity: 0,
        currentFocusDuration: 0,
      };

      aiWorker.checkAnalysisMode(sessionId, context, metrics).catch(logger.error);
    } catch (error) {
      logger.error('[SESSION BRIDGE] Analysis mode check failed:', error);
    }
  }

  // ~30-45 seconds of natural speech; enough context for meaningful narration
  private static readonly NARRATOR_WORD_THRESHOLD = 50;

  /**
   * Buffer transcript text for narrator and flush when enough words accumulate
   */
  private bufferTranscriptForNarrator(sessionId: string, text: string): void {
    if (this.pausedSessions.has(sessionId)) return;

    const buffer = this.narratorTranscriptBuffer.get(sessionId) || [];
    buffer.push(text);
    this.narratorTranscriptBuffer.set(sessionId, buffer);

    const wordCount = buffer.reduce((sum, t) => sum + t.split(/\s+/).length, 0);

    if (wordCount >= SessionBridgeService.NARRATOR_WORD_THRESHOLD) {
      const transcripts = [...buffer];
      this.narratorTranscriptBuffer.set(sessionId, []);

      getSession(sessionId).then(session => {
        const currentTitle = session?.title || '';
        const previousTopic = this.narratorPreviousTopic.get(sessionId) || null;

        aiWorker.narrateSession(sessionId, transcripts, currentTitle, previousTopic).catch(error => {
          logger.error('[SESSION BRIDGE] Failed to trigger narrator:', error);
        });
      }).catch(error => {
        logger.error('[SESSION BRIDGE] Failed to get session for narrator:', error);
      });
    }
  }

  /**
   * Get count of in-flight operations for a session
   */
  getInflightCount(sessionId: string): number {
    return this.inflightOps.get(sessionId)?.size || 0;
  }

  /**
   * Cleanup all listeners
   */
  destroy(): void {
    this.unsubscribers.forEach((unsub) => unsub());
    this.unsubscribers = [];
    this.listenersSetUp = false;
    this.activeSessions.clear();
    this.pausedSessions.clear();
    this.inflightOps.clear();
    this.narratorTranscriptBuffer.clear();
    this.narratorPreviousTopic.clear();
    this.summaryUpdateTimers.forEach((timer) => clearTimeout(timer));
    this.summaryUpdateTimers.clear();
    this.analysisCheckTimers.forEach((timer) => clearInterval(timer));
    this.analysisCheckTimers.clear();
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const sessionBridge = new SessionBridgeService();
