/**
 * Summarizer Bot
 *
 * Maintains and updates the rolling summary as the session progresses.
 * Runs periodically and when significant changes are detected.
 */

import { Baleybot } from '@baleybots/core';
import { RollingSummarySchema, type SessionContext, type RollingSummary } from './types';

const SYSTEM_PROMPT = `You are a session summarizer. Your job is to maintain a concise, evolving summary of a work session.

You receive:
- The current rolling summary (may be empty at start)
- Recent screenshot analyses describing what the user is doing
- Recent audio transcripts (if available)
- Recent insights already generated

Your output:
- An updated 2-4 sentence summary capturing the essence of the session so far
- Key moments worth highlighting (max 3-5 bullet points)
- The user's current focus in one phrase

Guidelines:
- Write in present tense for current activity, past tense for completed items
- Be specific about applications, documents, and activities when known
- Keep the summary coherent - it should read as a flowing narrative
- Don't just list activities; synthesize them into meaningful work description
- Each update should refine and extend, not replace entirely`;

export function createSummarizerBot() {
  return Baleybot.create({
    name: 'summarizer',
    goal: SYSTEM_PROMPT,
    model: 'claude-sonnet-4-20250514',
    outputSchema: RollingSummarySchema,
  });
}

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

export type { RollingSummary };
