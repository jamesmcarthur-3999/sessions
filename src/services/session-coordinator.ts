/**
 * Session Coordinator
 *
 * Orchestrates all session intelligence:
 * - Manages bot lifecycle
 * - Routes data to appropriate bots
 * - Streams insights to UI
 * - Handles analysis mode switching
 */

import { EventEmitter } from './event-emitter';
import type { SessionContext, ActivityDetection, RollingSummary, AnalysisModeDecision, QAResponse, CaptureTimingDecision } from './bots/types';
import type { ActivityMetrics, CaptureTimingMetrics } from './bots/input-builders';

// Capture timing fallback constants
const DEFAULT_CAPTURE_TIMING_MS = 60000;   // 60s - used when no API key
const FALLBACK_CAPTURE_TIMING_MS = 90000;  // 90s - used on errors/invalid responses
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
} from './database';
import { loadScreenshotData } from './screenshot-storage';
import type { DbScreenshot } from '../types/database';
import { withBotRetry } from '../utils/retry';
import { logger } from '../utils/logger';

// Re-export for use by other modules
export type { ActivityMetrics };

// Events emitted by the coordinator
export type CoordinatorEvents = {
  'summary-updated': { sessionId: string; summary: string };
  'insight-created': { sessionId: string; type: string; content: string };
  'mode-changed': { sessionId: string; mode: 'ambient' | 'deep'; reason: string };
  'activity-detected': { sessionId: string; activity: ActivityDetection };
  'capture-timing': { sessionId: string; recommendedWaitMs: number; activityLevel: string; reason: string };
  'chat-response': { sessionId: string; message: string };
  'error': { sessionId: string; error: string };
  'transcription-start': { sessionId: string };
  'transcription-complete': { sessionId: string; text: string };
};

type EventCallback<K extends keyof CoordinatorEvents> = (data: CoordinatorEvents[K]) => void;

class SessionCoordinatorService {
  private emitter = new EventEmitter<CoordinatorEvents>();
  private activeSessions = new Map<string, {
    intervalId: ReturnType<typeof setInterval> | null;
    lastAnalysisCheck: number;
  }>();

  // Activity tracking for adaptive analysis
  private activityTracking = new Map<string, {
    appSwitches: Array<{ app: string; timestamp: number }>;
    lastActivityTime: number;
    focusStartTime: number;
    currentApp: string | null;
  }>();

  // Pause state for sessions
  private pausedSessions = new Set<string>();

  // Bots module (loaded lazily to avoid loading Node.js dependencies at startup)
  private botsModule: typeof import('./bots') | null = null;
  private botInitPromise: Promise<typeof import('./bots')> | null = null;

  // Track last activity type for capture timing decisions
  private lastActivityType = new Map<string, string>();

  /**
   * Lazily load bots module and create bot instances
   * Uses promise lock to prevent concurrent initialization
   */
  private async ensureBots() {
    // Use existing promise if initialization in progress (prevents race condition)
    if (this.botInitPromise) {
      return this.botInitPromise;
    }

    // Return cached module if already loaded
    if (this.botsModule) {
      return this.botsModule;
    }

    // Create and store promise to prevent concurrent init
    this.botInitPromise = (async () => {
      const module = await import('./bots');

      // Initialize bots with API keys before first use
      const initialized = await module.initializeBots();
      if (!initialized) {
        logger.warn('[COORDINATOR] Bots not initialized - no API key configured');
      }

      this.botsModule = module;
      this.botInitPromise = null;
      return module;
    })();

    return this.botInitPromise;
  }

  /**
   * Subscribe to coordinator events
   */
  on<K extends keyof CoordinatorEvents>(event: K, callback: EventCallback<K>): () => void {
    return this.emitter.on(event, callback);
  }

  /**
   * Start coordinating a session
   */
  async startSession(sessionId: string): Promise<void> {
    if (this.activeSessions.has(sessionId)) {
      logger.warn('Session ' + sessionId + ' already active');
      return;
    }

    // Set up periodic analysis (every 30 seconds in ambient, every 10 in deep)
    const intervalId = setInterval(() => {
      this.runPeriodicAnalysis(sessionId);
    }, 30000);

    this.activeSessions.set(sessionId, {
      intervalId,
      lastAnalysisCheck: Date.now(),
    });

    logger.info('Session coordinator started for ' + sessionId);
  }

  /**
   * Stop coordinating a session
   */
  async stopSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);

    // Clear interval first to prevent new runs
    if (session?.intervalId) {
      clearInterval(session.intervalId);
    }

    // Remove from active sessions BEFORE any async work
    // This ensures runPeriodicAnalysis checks will fail immediately
    this.activeSessions.delete(sessionId);
    this.activityTracking.delete(sessionId);
    this.pausedSessions.delete(sessionId);
    this.lastActivityType.delete(sessionId);

    logger.info('Session coordinator stopped for ' + sessionId);
  }

  /**
   * Pause AI analysis for a session
   */
  pauseSession(sessionId: string): void {
    this.pausedSessions.add(sessionId);
    logger.info('[COORDINATOR] Session paused:', sessionId);
  }

  /**
   * Resume AI analysis for a session
   */
  resumeSession(sessionId: string): void {
    this.pausedSessions.delete(sessionId);
    logger.info('[COORDINATOR] Session resumed:', sessionId);
  }

  /**
   * Check if session is paused
   */
  isSessionPaused(sessionId: string): boolean {
    return this.pausedSessions.has(sessionId);
  }

  /**
   * Process a new screenshot
   */
  async processScreenshot(sessionId: string, screenshot: DbScreenshot): Promise<void> {
    try {
      // Skip analysis if session is paused
      if (this.pausedSessions.has(sessionId)) {
        logger.debug('[COORDINATOR] Skipping screenshot analysis - session paused');
        return;
      }

      const context = await this.buildContext(sessionId);
      const bots = await this.ensureBots();

      // Check if bots are ready (API key configured)
      if (!bots.isBotsReady()) {
        logger.debug('[COORDINATOR] Skipping screenshot analysis - no API key configured');
        // Still save basic metadata to screenshot
        await updateScreenshotAnalysis(screenshot.id, 'Analysis unavailable - configure API key in Settings');
        return;
      }

      // Load screenshot data from file
      const screenshotBase64 = await loadScreenshotData(screenshot.file_path);

      // Run activity detection with multimodal input
      // Compare with the most recent previous screenshot (last element since sorted ASC)
      const mostRecentPrevious = context.recentScreenshots[context.recentScreenshots.length - 1];
      const input = bots.buildActivityDetectorInput(
        screenshotBase64,
        mostRecentPrevious?.analysis || undefined
      );

      // Pass multimodal content to the activity bot
      // Baleybots combine() returns the correct format
      // Use retry wrapper to handle rate limits
      const result = await withBotRetry(() => bots.createActivityDetectorPipeline().process(input)) as unknown as ActivityDetection | null;

      // Validate bot response structure
      if (!result || typeof result !== 'object') {
        logger.error('[COORDINATOR] Invalid activity bot response:', result);
        await updateScreenshotAnalysis(screenshot.id, 'Analysis failed - invalid response');
        this.emitter.emit('error', {
          sessionId,
          error: 'Screenshot analysis returned invalid response',
        });
        return;
      }

      // Update screenshot with analysis
      await updateScreenshotAnalysis(screenshot.id, result.currentContext ?? 'Analysis unavailable');

      // Emit activity event
      this.emitter.emit('activity-detected', {
        sessionId,
        activity: result,
      });

      // Create insight if suggested
      if (result.suggestedInsight) {
        await createInsight(sessionId, 'moment', result.suggestedInsight);
        this.emitter.emit('insight-created', {
          sessionId,
          type: 'moment',
          content: result.suggestedInsight,
        });
      }

      // Check if we should update the summary
      if (result.hasSignificantChange) {
        await this.updateSummary(sessionId);
      }

      // Track activity type for timing decisions
      if (result.activityType) {
        this.lastActivityType.set(sessionId, result.activityType);
      }

      // Get AI recommendation for next capture timing
      await this.recommendCaptureTiming(sessionId, result.currentContext ?? null);
    } catch (error) {
      logger.error('Screenshot processing error:', error);
      this.emitter.emit('error', {
        sessionId,
        error: error instanceof Error ? error.message : 'Screenshot processing failed',
      });
    }
  }

  /**
   * Process an audio transcript
   */
  async processTranscript(sessionId: string, _transcript: string): Promise<void> {
    if (this.pausedSessions.has(sessionId)) {
      logger.debug('[COORDINATOR] Skipping transcript processing - session paused');
      return;
    }
    // Transcripts trigger summary updates more frequently
    await this.updateSummary(sessionId);
  }

  // NOTE: Audio chunk processing now happens in recording.ts -> ai-worker.ts
  // The worker handles transcription and emits events that session-bridge forwards to UI.

  /**
   * Track app switch activity
   */
  trackAppSwitch(sessionId: string, appName: string): void {
    // Only track for active sessions to prevent orphan entries
    if (!this.activeSessions.has(sessionId)) return;

    // Maximum app switches to track (bounded to prevent memory growth)
    const MAX_APP_SWITCHES = 100;

    let tracking = this.activityTracking.get(sessionId);
    const now = Date.now();

    if (!tracking) {
      tracking = {
        appSwitches: [],
        lastActivityTime: now,
        focusStartTime: now,
        currentApp: null,
      };
      this.activityTracking.set(sessionId, tracking);
    }

    tracking.lastActivityTime = now;

    if (appName !== tracking.currentApp) {
      tracking.appSwitches.push({ app: appName, timestamp: now });
      tracking.currentApp = appName;
      tracking.focusStartTime = now;

      // Keep bounded: drop oldest if at capacity (O(1) check, occasional O(n) splice)
      if (tracking.appSwitches.length > MAX_APP_SWITCHES) {
        // Remove first 20% when at capacity (amortized O(1))
        tracking.appSwitches.splice(0, Math.floor(MAX_APP_SWITCHES * 0.2));
      }
    }
  }

  /**
   * Compute activity metrics for adaptive analysis
   */
  computeActivityMetrics(sessionId: string, context: SessionContext): ActivityMetrics {
    const tracking = this.activityTracking.get(sessionId);
    const now = Date.now();

    const appSwitches = tracking?.appSwitches || [];
    const uniqueApps = new Set(appSwitches.map(s => s.app));

    // Count words in recent transcripts
    const wordCount = context.recentTranscripts
      .join(' ')
      .split(/\s+/)
      .filter(w => w.length > 0).length;

    return {
      appSwitchCount: appSwitches.length,
      uniqueAppsCount: uniqueApps.size,
      screenshotCount: context.recentScreenshots.length,
      audioWordCount: wordCount,
      averageScreenshotChangeMagnitude: 0.5, // Placeholder - activity detection returns boolean, not magnitude
      timeSinceLastActivity: tracking
        ? Math.floor((now - tracking.lastActivityTime) / 1000)
        : 0,
      currentFocusDuration: tracking
        ? Math.floor((now - tracking.focusStartTime) / 1000)
        : 0,
    };
  }

  /**
   * Get AI recommendation for next capture timing
   * This enables adaptive screenshot frequency based on content analysis
   */
  private async recommendCaptureTiming(
    sessionId: string,
    lastScreenshotAnalysis: string | null
  ): Promise<void> {
    // Check if session is still active before processing
    if (!this.activeSessions.has(sessionId)) {
      return;
    }

    const bots = await this.ensureBots();

    // Skip if no API key or bots not ready
    if (!bots.isBotsReady()) {
      this.emitter.emit('capture-timing', {
        sessionId,
        recommendedWaitMs: DEFAULT_CAPTURE_TIMING_MS,
        activityLevel: 'medium',
        reason: 'Default timing (no API key)',
      });
      return;
    }

    try {
      const tracking = this.activityTracking.get(sessionId);
      const session = await getSession(sessionId);

      const metrics: CaptureTimingMetrics = {
        appSwitchCount: tracking?.appSwitches.length ?? 0,
        timeSinceLastCapture: 0, // Just captured, so 0
        lastActivityType: this.lastActivityType.get(sessionId) ?? 'unknown',
        analysisMode: session?.analysis_mode === 'deep' ? 'deep' : 'ambient',
      };

      const input = bots.buildCaptureTimingInput(lastScreenshotAnalysis, metrics);

      // Use retry wrapper to handle rate limits
      const result = await withBotRetry(() => bots.createCaptureTimingPipeline().process(input)) as unknown as CaptureTimingDecision | null;

      // Validate response and extract timing
      if (result && typeof result.recommendedWaitSeconds === 'number') {
        // Clamp to valid range (5-180 seconds)
        const clampedSeconds = Math.max(5, Math.min(180, result.recommendedWaitSeconds));
        const waitMs = clampedSeconds * 1000;

        this.emitter.emit('capture-timing', {
          sessionId,
          recommendedWaitMs: waitMs,
          activityLevel: result.activityLevel ?? 'medium',
          reason: result.reason ?? 'AI timing recommendation',
        });

        logger.debug('[COORDINATOR] Capture timing recommendation:', {
          waitSeconds: clampedSeconds,
          activityLevel: result.activityLevel,
          reason: result.reason,
        });
      } else {
        // Fall back if AI response is invalid
        this.emitter.emit('capture-timing', {
          sessionId,
          recommendedWaitMs: FALLBACK_CAPTURE_TIMING_MS,
          activityLevel: 'medium',
          reason: 'Default timing (invalid AI response)',
        });
      }
    } catch (error) {
      logger.error('[COORDINATOR] Capture timing error for session', sessionId, ':', error);
      // Fall back on error
      this.emitter.emit('capture-timing', {
        sessionId,
        recommendedWaitMs: FALLBACK_CAPTURE_TIMING_MS,
        activityLevel: 'medium',
        reason: 'Default timing (error)',
      });
    }
  }

  /**
   * Handle a chat message from the user
   */
  async handleChatMessage(sessionId: string, message: string): Promise<string> {
    // Save user message
    await saveChatMessage(sessionId, 'user', message);

    const bots = await this.ensureBots();

    // Check if bots are ready
    if (!bots.isBotsReady()) {
      const noKeyResponse = 'I need an API key to answer questions. Please configure your Claude API key in Settings.';
      await saveChatMessage(sessionId, 'assistant', noKeyResponse);
      this.emitter.emit('chat-response', {
        sessionId,
        message: noKeyResponse,
      });
      return noKeyResponse;
    }

    const context = await this.buildContext(sessionId);

    try {
      const input = bots.buildQAInput(message, context);
      // Use retry wrapper to handle rate limits
      const result = await withBotRetry(() => bots.createQABotPipeline().process(input)) as unknown as QAResponse | null;

      // Validate bot response structure
      const answer = result?.answer ?? 'Sorry, I was unable to generate a response. Please try again.';

      // Save assistant response
      await saveChatMessage(sessionId, 'assistant', answer);

      this.emitter.emit('chat-response', {
        sessionId,
        message: answer,
      });

      return answer;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to process question';
      this.emitter.emit('error', { sessionId, error: errorMsg });
      throw error;
    }
  }

  /**
   * Manually set analysis mode
   */
  async setAnalysisMode(sessionId: string, mode: 'ambient' | 'deep'): Promise<void> {
    await updateAnalysisMode(sessionId, mode);
    this.emitter.emit('mode-changed', {
      sessionId,
      mode,
      reason: 'Manual override',
    });
  }

  /**
   * Run periodic analysis tasks
   */
  private async runPeriodicAnalysis(sessionId: string): Promise<void> {
    // Check if session still active (might have been stopped between interval ticks)
    if (!this.activeSessions.has(sessionId)) {
      return;
    }

    if (this.pausedSessions.has(sessionId)) {
      return; // Skip periodic analysis when paused
    }

    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const context = await this.buildContext(sessionId);

    // Update summary periodically
    await this.updateSummary(sessionId);

    // Check if analysis mode should change (every 2 minutes)
    const now = Date.now();
    if (now - session.lastAnalysisCheck > 120000) {
      session.lastAnalysisCheck = now;
      await this.checkAnalysisMode(sessionId, context);
    }
  }

  /**
   * Update the rolling summary
   */
  private async updateSummary(sessionId: string): Promise<void> {
    const bots = await this.ensureBots();

    // Skip if no API key configured
    if (!bots.isBotsReady()) {
      logger.debug('[COORDINATOR] Skipping summary update - no API key configured');
      return;
    }

    const context = await this.buildContext(sessionId);

    try {
      const input = bots.buildSummarizerInput(context);
      // Use retry wrapper to handle rate limits
      const result = await withBotRetry(() => bots.createSummarizerPipeline().process(input)) as unknown as RollingSummary | null;

      // Validate bot response structure
      const summary = result?.summary;
      if (!summary) {
        logger.error('[COORDINATOR] Invalid summarizer bot response:', result);
        return; // Don't overwrite existing summary with empty content
      }

      await updateRollingSummary(sessionId, summary);

      this.emitter.emit('summary-updated', {
        sessionId,
        summary,
      });
    } catch (error) {
      logger.error('Summary update error:', error);
      this.emitter.emit('error', {
        sessionId,
        error: 'AI summary update failed. Check your Claude API key in Settings.',
      });
    }
  }

  /**
   * Check if analysis mode should change
   */
  private async checkAnalysisMode(sessionId: string, context: SessionContext): Promise<void> {
    const bots = await this.ensureBots();

    // Skip if no API key configured
    if (!bots.isBotsReady()) {
      return;
    }

    const metrics = this.computeActivityMetrics(sessionId, context);

    try {
      const input = bots.buildAnalysisControllerInput(context, metrics);
      // Use retry wrapper to handle rate limits
      const result = await withBotRetry(() => bots.createAnalysisControllerPipeline().process(input)) as unknown as AnalysisModeDecision | null;

      // Validate bot response structure
      if (!result || typeof result.confidence !== 'number' || !result.recommendedMode) {
        logger.error('[COORDINATOR] Invalid analysis controller bot response:', result);
        return;
      }

      // Only change if confident and different from current
      if (result.confidence > 0.7 && result.recommendedMode !== context.analysisMode) {
        await updateAnalysisMode(sessionId, result.recommendedMode);
        this.emitter.emit('mode-changed', {
          sessionId,
          mode: result.recommendedMode,
          reason: result.reason || 'Mode adjustment based on activity',
        });

        // Log mode change with metrics
        logger.info('[COORDINATOR] Mode changed to', result.recommendedMode, 'due to:', result.reason, metrics);
      }
    } catch (error) {
      logger.error('Analysis mode check error:', error);
    }
  }

  /**
   * Build session context for bots
   */
  private async buildContext(sessionId: string): Promise<SessionContext> {
    const [session, screenshots, audioChunks, insights, summary] = await Promise.all([
      getSession(sessionId),
      getScreenshots(sessionId, 10),
      getAudioChunks(sessionId),
      getInsights(sessionId),
      getRollingSummary(sessionId),
    ]);

    if (!session) throw new Error('Session not found: ' + sessionId);

    return {
      sessionId,
      rollingSummary: summary?.content || '',
      recentScreenshots: screenshots.map(s => ({
        id: s.id,
        capturedAt: s.captured_at,
        appName: s.app_name,
        windowTitle: s.window_title,
        analysis: s.analysis,
      })),
      recentTranscripts: audioChunks
        .filter(c => c.transcript)
        .slice(-5)
        .map(c => c.transcript!),
      recentInsights: insights.slice(0, 10).map(i => i.content),
      durationSeconds: session.duration_seconds || 0,
      analysisMode: session.analysis_mode === 'deep' ? 'deep' : 'ambient',
    };
  }
}

export const sessionCoordinator = new SessionCoordinatorService();
