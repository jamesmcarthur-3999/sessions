/**
 * Input Builders for Bot Pipelines
 *
 * Consolidated from individual bot wrapper files.
 * These functions format data for the various bot pipelines.
 */

import { combine, text, image } from '@baleybots/core';
import type { SessionContext } from './types';
import type { DbScreenshot, DbAudioChunk, DbInsight, DbRollingSummary } from '../../types/database';

// ============================================================================
// Interfaces
// ============================================================================

/**
 * Activity metrics for adaptive analysis decisions
 */
export interface ActivityMetrics {
  appSwitchCount: number;
  uniqueAppsCount: number;
  screenshotCount: number;
  audioWordCount: number;
  averageScreenshotChangeMagnitude: number;
  timeSinceLastActivity: number;
  currentFocusDuration: number;
}

/**
 * Activity metrics for timing decisions
 */
export interface CaptureTimingMetrics {
  appSwitchCount: number;
  timeSinceLastCapture: number;
  lastActivityType: string;
  analysisMode: 'ambient' | 'deep';
}

/**
 * Input structure for final summary generation
 */
export interface FinalSummaryInput {
  rollingSummary: DbRollingSummary | null;
  insights: DbInsight[];
  audioChunks: DbAudioChunk[];
  screenshots: DbScreenshot[];
  durationSeconds: number;
  title: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Sample items evenly distributed across an array
 * E.g., for 100 items sampled to 20, takes items at indices 0, 5, 10, 15, ...
 */
function sampleEvenly<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;

  const result: T[] = [];
  const step = (items.length - 1) / (count - 1);

  for (let i = 0; i < count; i++) {
    const index = Math.round(i * step);
    result.push(items[index]);
  }

  return result;
}

// ============================================================================
// Input Builders
// ============================================================================

/**
 * Build multimodal input for activity detection
 * Preserves the combine() pattern for image + text input
 */
export function buildActivityDetectorInput(
  screenshotBase64: string,
  previousContext?: string
) {
  // Detect media type from data URL prefix, default to jpeg (our optimized format)
  let mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' = 'image/jpeg';
  if (screenshotBase64.includes('data:image/png')) {
    mediaType = 'image/png';
  } else if (screenshotBase64.includes('data:image/gif')) {
    mediaType = 'image/gif';
  } else if (screenshotBase64.includes('data:image/webp')) {
    mediaType = 'image/webp';
  }

  // Strip data URL prefix if present
  const imageData = screenshotBase64.replace(/^data:image\/\w+;base64,/, '');

  const textPrompt = previousContext
    ? `Previous context: ${previousContext}\n\nAnalyze this new screenshot:`
    : 'Analyze this screenshot from the start of a work session:';

  // Use the multimodal combine helper for proper Baleybots format
  return combine(
    text(textPrompt),
    image({
      data: imageData,
      mediaType,
    })
  );
}

/**
 * Build input for the summarizer bot
 */
export function buildSummarizerInput(context: SessionContext): string {
  const parts: string[] = [];

  parts.push(`## Current Session Duration: ${Math.floor(context.durationSeconds / 60)} minutes`);

  if (context.rollingSummary) {
    parts.push(`## Current Summary:\n${context.rollingSummary}`);
  } else {
    parts.push('## Current Summary:\n(Session just started)');
  }

  if (context.recentScreenshots.length > 0) {
    parts.push('## Recent Activity (from screenshots):');
    for (const ss of context.recentScreenshots) {
      const time = new Date(ss.capturedAt).toLocaleTimeString();
      const app = ss.appName || 'Unknown app';
      const analysis = ss.analysis || 'No analysis yet';
      parts.push(`- [${time}] ${app}: ${analysis}`);
    }
  }

  if (context.recentTranscripts.length > 0) {
    parts.push('## Recent Audio (transcribed):');
    parts.push(context.recentTranscripts.join('\n'));
  }

  if (context.recentInsights.length > 0) {
    parts.push('## Recent Insights:');
    parts.push(context.recentInsights.map(i => `- ${i}`).join('\n'));
  }

  parts.push('\nPlease update the rolling summary based on this information.');

  return parts.join('\n\n');
}

/**
 * Build input for the analysis controller bot
 */
export function buildAnalysisControllerInput(
  context: SessionContext,
  metrics?: ActivityMetrics
): string {
  const parts: string[] = [];

  parts.push(`## Current Mode: ${context.analysisMode}`);
  parts.push(`## Session Duration: ${Math.floor(context.durationSeconds / 60)} minutes`);

  // Use provided metrics if available, otherwise compute from context
  if (metrics) {
    parts.push('\n## Activity Metrics (last 2 minutes):');
    parts.push(`- App switches: ${metrics.appSwitchCount}`);
    parts.push(`- Unique apps: ${metrics.uniqueAppsCount}`);
    parts.push(`- Screenshots: ${metrics.screenshotCount}`);
    parts.push(`- Audio words: ${metrics.audioWordCount}`);
    parts.push(`- Idle time: ${metrics.timeSinceLastActivity}s`);
    parts.push(`- Current focus: ${metrics.currentFocusDuration}s`);

    parts.push('\n## Mode Guidelines:');
    parts.push('- **Deep mode** triggers: >3 app switches, >50 words spoken, multi-app workflow');
    parts.push('- **Ambient mode** triggers: <2 app switches, no audio, single-app focus >5min');
  } else {
    // Fallback to analyzing from context
    if (context.recentScreenshots.length > 0) {
      const apps = new Set(context.recentScreenshots.map(s => s.appName).filter(Boolean));
      parts.push(`## Recent Screenshots: ${context.recentScreenshots.length}`);
      parts.push(`## Unique Apps: ${apps.size} (${Array.from(apps).join(', ')})`);
    }

    if (context.recentTranscripts.length > 0) {
      const wordCount = context.recentTranscripts.join(' ').split(/\s+/).length;
      parts.push(`## Recent Audio: ${wordCount} words transcribed`);
    } else {
      parts.push('## Recent Audio: None');
    }
  }

  parts.push(`## Recent Insights: ${context.recentInsights.length}`);
  parts.push('\nBased on these metrics, should we change analysis mode?');

  return parts.join('\n');
}

/**
 * Build input for the Q&A bot
 */
export function buildQAInput(question: string, context: SessionContext): string {
  const parts: string[] = [];

  parts.push(`## Session Summary:\n${context.rollingSummary || 'No summary yet.'}`);
  parts.push(`## Duration: ${Math.floor(context.durationSeconds / 60)} minutes`);

  if (context.recentScreenshots.length > 0) {
    parts.push('## Recent Activity:');
    for (const ss of context.recentScreenshots.slice(0, 10)) {
      const time = new Date(ss.capturedAt).toLocaleTimeString();
      const app = ss.appName || 'Unknown';
      parts.push(`- [${time}] ${app}: ${ss.analysis || 'No analysis'}`);
    }
  }

  if (context.recentTranscripts.length > 0) {
    parts.push('## Recent Transcripts:');
    parts.push(context.recentTranscripts.slice(0, 5).join('\n'));
  }

  if (context.recentInsights.length > 0) {
    parts.push('## Key Insights:');
    parts.push(context.recentInsights.map(i => `- ${i}`).join('\n'));
  }

  parts.push(`\n## User Question:\n${question}`);

  return parts.join('\n\n');
}

/**
 * Build input for the final summary bot
 */
export function buildFinalSummaryInput(input: FinalSummaryInput): string {
  const parts: string[] = [];

  parts.push(`# Session: ${input.title}`);
  parts.push(`Duration: ${Math.floor(input.durationSeconds / 60)} minutes`);

  // Rolling summary from live analysis
  if (input.rollingSummary?.content) {
    parts.push('\n## Live Summary (from during the session):');
    parts.push(input.rollingSummary.content);
  }

  // Insights collected during session
  if (input.insights.length > 0) {
    parts.push('\n## Insights Collected:');
    for (const insight of input.insights) {
      const time = new Date(insight.created_at).toLocaleTimeString();
      parts.push(`- [${time}] (${insight.type}) ${insight.content}`);
    }
  }

  // Audio transcripts
  const transcripts = input.audioChunks
    .filter(c => c.transcript)
    .map(c => c.transcript!);

  if (transcripts.length > 0) {
    parts.push('\n## Audio Transcripts:');
    parts.push(transcripts.join('\n\n'));
  }

  // Screenshot analyses - sample evenly across session timeline
  const analyzedScreenshots = input.screenshots.filter(s => s.analysis);
  if (analyzedScreenshots.length > 0) {
    parts.push('\n## Activity Log (from screenshots):');

    // Smart sampling: take up to 20 screenshots evenly distributed across session
    const maxScreenshots = 20;
    const sampled = analyzedScreenshots.length <= maxScreenshots
      ? analyzedScreenshots
      : sampleEvenly(analyzedScreenshots, maxScreenshots);

    for (const ss of sampled) {
      const time = new Date(ss.captured_at).toLocaleTimeString();
      const app = ss.app_name || 'Unknown app';
      parts.push(`- [${time}] ${app}: ${ss.analysis}`);
    }

    if (analyzedScreenshots.length > maxScreenshots) {
      parts.push(`\n(Sampled ${maxScreenshots} of ${analyzedScreenshots.length} screenshots)`);
    }
  }

  parts.push('\n---');
  parts.push('Please generate a comprehensive final summary with tasks and notes.');

  return parts.join('\n');
}

/**
 * Build input for the capture bot
 */
export function buildCaptureInput(text: string, attachmentDescriptions?: string[]): string {
  const parts: string[] = [];

  parts.push('Please analyze this captured content:');
  parts.push('');
  parts.push(text);

  if (attachmentDescriptions && attachmentDescriptions.length > 0) {
    parts.push('');
    parts.push('Attachments:');
    for (const desc of attachmentDescriptions) {
      parts.push(`- ${desc}`);
    }
  }

  return parts.join('\n');
}

/**
 * Build input for the capture timing bot
 */
export function buildCaptureTimingInput(
  lastScreenshotAnalysis: string | null,
  metrics: CaptureTimingMetrics
): string {
  const parts: string[] = [];

  parts.push('## Last Screenshot Analysis');
  if (lastScreenshotAnalysis) {
    parts.push(lastScreenshotAnalysis);
  } else {
    parts.push('No previous screenshot analysis available (session just started)');
  }

  parts.push('\n## Activity Metrics');
  parts.push(`- App switches in last 2 min: ${metrics.appSwitchCount}`);
  parts.push(`- Time since last capture: ${metrics.timeSinceLastCapture} seconds`);
  parts.push(`- Last activity type: ${metrics.lastActivityType}`);
  parts.push(`- Analysis mode: ${metrics.analysisMode}`);

  parts.push('\n## Guidelines Reminder');
  parts.push('- Minimum: 5 seconds (for curious follow-ups)');
  parts.push('- Maximum: 180 seconds');
  parts.push('- High activity (meetings, rapid changes): 5-30s');
  parts.push('- Medium activity (normal work): 30-90s');
  parts.push('- Low activity (focused work, reading): 60-180s');

  parts.push('\nBased on the above, when should we capture the next screenshot?');

  return parts.join('\n');
}
