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

export function buildAnalysisControllerInput(context: SessionContext): string {
  const parts: string[] = [];

  parts.push(`## Current Mode: ${context.analysisMode}`);
  parts.push(`## Session Duration: ${Math.floor(context.durationSeconds / 60)} minutes`);

  // Analyze screenshot frequency and diversity
  if (context.recentScreenshots.length > 0) {
    const apps = new Set(context.recentScreenshots.map(s => s.appName).filter(Boolean));
    parts.push(`## Recent Screenshots: ${context.recentScreenshots.length}`);
    parts.push(`## Unique Apps: ${apps.size} (${Array.from(apps).join(', ')})`);
  }

  // Check audio activity
  if (context.recentTranscripts.length > 0) {
    const wordCount = context.recentTranscripts.join(' ').split(/\s+/).length;
    parts.push(`## Recent Audio: ${wordCount} words transcribed`);
  } else {
    parts.push('## Recent Audio: None');
  }

  // Recent insights as indicator of activity
  parts.push(`## Recent Insights: ${context.recentInsights.length}`);

  parts.push('\nBased on this activity pattern, what analysis mode is appropriate?');

  return parts.join('\n');
}

export type { AnalysisModeDecision };
