/**
 * Analysis Controller Bot
 *
 * Monitors session intensity and decides when to escalate
 * or de-escalate analysis depth.
 */

import { Baleybot } from '@baleybots/core';
import { AnalysisModeDecisionSchema, type SessionContext, type AnalysisModeDecision } from './types';

const SYSTEM_PROMPT = `You are an analysis controller that decides the appropriate analysis intensity for a work session.

Modes:
- **ambient**: Light analysis. Good for focused single-app work, quiet periods, or when the user is in flow.
- **deep**: Intensive real-time analysis. Good for complex multi-app workflows, meetings, rapid context switching.

Consider:
- How frequently is the user switching apps/contexts?
- Is there significant audio activity (meetings, calls)?
- How complex is the current workflow?
- Would more analysis help or just add noise?

Err toward ambient unless there's clear benefit from deep analysis.`;

export function createAnalysisControllerBot() {
  return Baleybot.create({
    name: 'analysis-controller',
    goal: SYSTEM_PROMPT,
    model: 'claude-sonnet-4-20250514',
    outputSchema: AnalysisModeDecisionSchema,
  });
}

export interface ActivityMetrics {
  appSwitchCount: number;
  uniqueAppsCount: number;
  screenshotCount: number;
  audioWordCount: number;
  averageScreenshotChangeMagnitude: number;
  timeSinceLastActivity: number;
  currentFocusDuration: number;
}

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

export type { AnalysisModeDecision };
