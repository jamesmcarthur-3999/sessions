/**
 * Final Summary Bot
 *
 * Generates a comprehensive final summary when a session ends.
 * Consumes all accumulated intelligence: rolling summary, insights,
 * transcripts, and screenshot analyses.
 */

import { Baleybot } from '@baleybots/core';
import { FinalSummarySchema, type FinalSummary } from './types';
import type { DbScreenshot, DbAudioChunk, DbInsight, DbRollingSummary } from '../../types/database';

const SYSTEM_PROMPT = `You are a session summarizer creating a comprehensive final summary of a completed work session.

You receive:
- The rolling summary that was maintained during the session
- Insights generated during the session
- Audio transcripts (if available)
- Screenshot analyses describing user activities

Your job is to:
1. Write a comprehensive 2-4 paragraph summary capturing the entire session
2. Extract ALL actionable tasks and follow-ups (things the user needs to do)
3. Extract key notes and insights worth remembering

Guidelines:
- Be specific about applications, documents, and activities
- Tasks should be clear and actionable (start with verbs)
- Notes should capture important decisions, insights, or information
- The summary should tell the complete story of what was accomplished
- Don't miss any tasks mentioned in transcripts or visible in screenshots
- Look for implicit tasks (TODOs, FIXMEs, "need to", "should", "must", etc.)`;

export function createFinalSummaryBot() {
  return Baleybot.create({
    name: 'final-summary',
    goal: SYSTEM_PROMPT,
    model: 'claude-sonnet-4-20250514',
    outputSchema: FinalSummarySchema,
  });
}

export interface FinalSummaryInput {
  rollingSummary: DbRollingSummary | null;
  insights: DbInsight[];
  audioChunks: DbAudioChunk[];
  screenshots: DbScreenshot[];
  durationSeconds: number;
  title: string;
}

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

  // Screenshot analyses
  const analyzedScreenshots = input.screenshots.filter(s => s.analysis);
  if (analyzedScreenshots.length > 0) {
    parts.push('\n## Activity Log (from screenshots):');
    for (const ss of analyzedScreenshots.slice(0, 20)) { // Limit to avoid token overflow
      const time = new Date(ss.captured_at).toLocaleTimeString();
      const app = ss.app_name || 'Unknown app';
      parts.push(`- [${time}] ${app}: ${ss.analysis}`);
    }
  }

  parts.push('\n---');
  parts.push('Please generate a comprehensive final summary with tasks and notes.');

  return parts.join('\n');
}

export type { FinalSummary };
