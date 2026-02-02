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
import type { DbScreenshot } from '../types/database';

// Events emitted by the coordinator
export type CoordinatorEvents = {
  'summary-updated': { sessionId: string; summary: string };
  'insight-created': { sessionId: string; type: string; content: string };
  'mode-changed': { sessionId: string; mode: 'ambient' | 'deep'; reason: string };
  'activity-detected': { sessionId: string; activity: ActivityDetection };
  'chat-response': { sessionId: string; message: string };
  'error': { sessionId: string; error: string };
};

type EventCallback<K extends keyof CoordinatorEvents> = (data: CoordinatorEvents[K]) => void;

class SessionCoordinatorService {
  private emitter = new EventEmitter<CoordinatorEvents>();
  private activeSessions = new Map<string, {
    intervalId: ReturnType<typeof setInterval> | null;
    lastAnalysisCheck: number;
  }>();

  // Bot instances (created lazily to avoid loading Node.js dependencies at startup)
  private summarizerBot: Awaited<ReturnType<typeof import('./bots').createSummarizerBot>> | null = null;
  private activityBot: Awaited<ReturnType<typeof import('./bots').createActivityDetectorBot>> | null = null;
  private analysisControllerBot: Awaited<ReturnType<typeof import('./bots').createAnalysisControllerBot>> | null = null;
  private qaBot: Awaited<ReturnType<typeof import('./bots').createQABot>> | null = null;
  private botsModule: typeof import('./bots') | null = null;

  /**
   * Lazily load bots module and create bot instances
   */
  private async ensureBots() {
    if (!this.botsModule) {
      this.botsModule = await import('./bots');
    }
    if (!this.summarizerBot) {
      this.summarizerBot = this.botsModule.createSummarizerBot();
    }
    if (!this.activityBot) {
      this.activityBot = this.botsModule.createActivityDetectorBot();
    }
    if (!this.analysisControllerBot) {
      this.analysisControllerBot = this.botsModule.createAnalysisControllerBot();
    }
    if (!this.qaBot) {
      this.qaBot = this.botsModule.createQABot();
    }
    return this.botsModule;
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
    if (session?.intervalId) {
      clearInterval(session.intervalId);
    }
    this.activeSessions.delete(sessionId);
    console.log('Session coordinator stopped for ' + sessionId);
  }

  /**
   * Process a new screenshot
   */
  async processScreenshot(sessionId: string, screenshot: DbScreenshot): Promise<void> {
    const context = await this.buildContext(sessionId);
    const bots = await this.ensureBots();

    try {
      // Run activity detection with multimodal input
      const input = bots.buildActivityDetectorInput(
        screenshot.data_base64,
        context.recentScreenshots[1]?.analysis || undefined
      );

      // Pass both text and image to the activity bot
      const result = await this.activityBot!.process([input.text, input.image]);

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
      console.error('Activity detection error:', error);
      this.emitter.emit('error', {
        sessionId,
        error: error instanceof Error ? error.message : 'Activity detection failed',
      });
    }
  }

  /**
   * Process an audio transcript
   */
  async processTranscript(sessionId: string, _transcript: string): Promise<void> {
    // Transcripts trigger summary updates more frequently
    await this.updateSummary(sessionId);
  }

  /**
   * Handle a chat message from the user
   */
  async handleChatMessage(sessionId: string, message: string): Promise<string> {
    // Save user message
    await saveChatMessage(sessionId, 'user', message);

    const context = await this.buildContext(sessionId);
    const bots = await this.ensureBots();

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
    const context = await this.buildContext(sessionId);
    const bots = await this.ensureBots();

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
    }
  }

  /**
   * Check if analysis mode should change
   */
  private async checkAnalysisMode(sessionId: string, context: SessionContext): Promise<void> {
    const bots = await this.ensureBots();

    try {
      const input = bots.buildAnalysisControllerInput(context);
      const result = await this.analysisControllerBot!.process(input);

      // Only change if confident and different from current
      if (result.confidence > 0.7 && result.recommendedMode !== context.analysisMode) {
        await updateAnalysisMode(sessionId, result.recommendedMode);
        this.emitter.emit('mode-changed', {
          sessionId,
          mode: result.recommendedMode,
          reason: result.reason,
        });
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
