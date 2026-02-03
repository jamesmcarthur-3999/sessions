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
import type { SessionContext, ActivityDetection } from './bots/types';
import type { ActivityMetrics } from './bots/analysis-controller';
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
  saveAudioChunk,
  updateAudioTranscript,
} from './database';
import type { DbScreenshot } from '../types/database';
import { transcriptionService } from './transcription';

// Re-export for use by other modules
export type { ActivityMetrics };

// Events emitted by the coordinator
export type CoordinatorEvents = {
  'summary-updated': { sessionId: string; summary: string };
  'insight-created': { sessionId: string; type: string; content: string };
  'mode-changed': { sessionId: string; mode: 'ambient' | 'deep'; reason: string };
  'activity-detected': { sessionId: string; activity: ActivityDetection };
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

  // Bot instances (created lazily to avoid loading Node.js dependencies at startup)
  private summarizerBot: Awaited<ReturnType<typeof import('./bots').createSummarizerBot>> | null = null;
  private activityBot: Awaited<ReturnType<typeof import('./bots').createActivityDetectorBot>> | null = null;
  private analysisControllerBot: Awaited<ReturnType<typeof import('./bots').createAnalysisControllerBot>> | null = null;
  private qaBot: Awaited<ReturnType<typeof import('./bots').createQABot>> | null = null;
  private botsModule: typeof import('./bots') | null = null;
  private botInitPromise: Promise<typeof import('./bots')> | null = null;

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
        console.warn('[COORDINATOR] Bots not initialized - no API key configured');
      }

      this.botsModule = module;
      this.botInitPromise = null;
      return module;
    })();

    const module = await this.botInitPromise;

    // Create bot instances after module is loaded
    if (!this.summarizerBot) {
      this.summarizerBot = module.createSummarizerBot();
    }
    if (!this.activityBot) {
      this.activityBot = module.createActivityDetectorBot();
    }
    if (!this.analysisControllerBot) {
      this.analysisControllerBot = module.createAnalysisControllerBot();
    }
    if (!this.qaBot) {
      this.qaBot = module.createQABot();
    }
    return module;
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
      console.warn('Session ' + sessionId + ' already active');
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

    console.log('Session coordinator started for ' + sessionId);
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

    console.log('Session coordinator stopped for ' + sessionId);
  }

  /**
   * Pause AI analysis for a session
   */
  pauseSession(sessionId: string): void {
    this.pausedSessions.add(sessionId);
    console.log('[COORDINATOR] Session paused:', sessionId);
  }

  /**
   * Resume AI analysis for a session
   */
  resumeSession(sessionId: string): void {
    this.pausedSessions.delete(sessionId);
    console.log('[COORDINATOR] Session resumed:', sessionId);
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
        console.log('[COORDINATOR] Skipping screenshot analysis - session paused');
        return;
      }

      const context = await this.buildContext(sessionId);
      const bots = await this.ensureBots();

      // Check if bots are ready (API key configured)
      if (!bots.isBotsReady()) {
        console.log('[COORDINATOR] Skipping screenshot analysis - no API key configured');
        // Still save basic metadata to screenshot
        await updateScreenshotAnalysis(screenshot.id, 'Analysis unavailable - configure API key in Settings');
        return;
      }

      // Run activity detection with multimodal input
      // Compare with the most recent previous screenshot (last element since sorted ASC)
      const mostRecentPrevious = context.recentScreenshots[context.recentScreenshots.length - 1];
      const input = bots.buildActivityDetectorInput(
        screenshot.data_base64,
        mostRecentPrevious?.analysis || undefined
      );

      // Pass multimodal content to the activity bot
      // Baleybots combine() returns the correct format
      const result = await this.activityBot!.process(input);

      // Update screenshot with analysis
      await updateScreenshotAnalysis(screenshot.id, result.currentContext);

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
    } catch (error) {
      console.error('Screenshot processing error:', error);
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
      console.log('[COORDINATOR] Skipping transcript processing - session paused');
      return;
    }
    // Transcripts trigger summary updates more frequently
    await this.updateSummary(sessionId);
  }

  /**
   * Process a new audio chunk (save, transcribe, update)
   */
  async processAudioChunk(
    sessionId: string,
    audioBase64: string,
    durationSeconds: number
  ): Promise<void> {
    // Skip processing if session is paused (saves API credits)
    if (this.pausedSessions.has(sessionId)) {
      console.log('[COORDINATOR] Skipping audio chunk processing - session paused');
      return;
    }

    const now = new Date();
    const startTime = new Date(now.getTime() - durationSeconds * 1000).toISOString();
    const endTime = now.toISOString();

    // Save audio chunk to database
    const chunk = await saveAudioChunk(
      sessionId,
      startTime,
      endTime,
      durationSeconds,
      audioBase64
    );

    console.log('[COORDINATOR] Audio chunk saved:', chunk.id);

    // Transcribe audio
    try {
      // Notify UI that transcription is starting
      this.emitter.emit('transcription-start', { sessionId });

      const result = await transcriptionService.transcribe(audioBase64);

      if (result.text) {
        // Update chunk with transcript
        await updateAudioTranscript(chunk.id, result.text);

        // Track activity (word count affects mode)
        this.trackAudioActivity(sessionId, result.text);

        // Trigger summary update with new transcript
        await this.processTranscript(sessionId, result.text);

        // Notify UI that transcription completed
        this.emitter.emit('transcription-complete', { sessionId, text: result.text });

        console.log('[COORDINATOR] Audio transcribed:', result.text.substring(0, 100) + '...');
      }
    } catch (error) {
      console.error('[COORDINATOR] Transcription failed:', error);
      this.emitter.emit('error', {
        sessionId,
        error: 'Audio transcription failed. Check your OpenAI API key in Settings.',
      });
    }
  }

  /**
   * Track app switch activity
   */
  trackAppSwitch(sessionId: string, appName: string): void {
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

      // Keep only last 2 minutes of switches
      const twoMinutesAgo = now - 120000;
      tracking.appSwitches = tracking.appSwitches.filter(s => s.timestamp > twoMinutesAgo);
    }
  }

  /**
   * Track audio activity (for word count metrics)
   */
  private trackAudioActivity(sessionId: string, _transcript: string): void {
    const tracking = this.activityTracking.get(sessionId);
    if (tracking) {
      tracking.lastActivityTime = Date.now();
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
      const result = await this.qaBot!.process(input);

      // Save assistant response
      await saveChatMessage(sessionId, 'assistant', result.answer);

      this.emitter.emit('chat-response', {
        sessionId,
        message: result.answer,
      });

      return result.answer;
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
      console.log('[COORDINATOR] Skipping summary update - no API key configured');
      return;
    }

    const context = await this.buildContext(sessionId);

    try {
      const input = bots.buildSummarizerInput(context);
      const result = await this.summarizerBot!.process(input);

      await updateRollingSummary(sessionId, result.summary);

      this.emitter.emit('summary-updated', {
        sessionId,
        summary: result.summary,
      });
    } catch (error) {
      console.error('Summary update error:', error);
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
      const result = await this.analysisControllerBot!.process(input);

      // Only change if confident and different from current
      if (result.confidence > 0.7 && result.recommendedMode !== context.analysisMode) {
        await updateAnalysisMode(sessionId, result.recommendedMode);
        this.emitter.emit('mode-changed', {
          sessionId,
          mode: result.recommendedMode,
          reason: result.reason,
        });

        // Log mode change with metrics
        console.log('[COORDINATOR] Mode changed to', result.recommendedMode, 'due to:', result.reason, metrics);
      }
    } catch (error) {
      console.error('Analysis mode check error:', error);
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
      analysisMode: session.analysis_mode as 'ambient' | 'deep',
    };
  }
}

export const sessionCoordinator = new SessionCoordinatorService();
