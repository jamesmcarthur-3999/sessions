/**
 * Q&A Bot
 *
 * Answers user questions about their session using
 * all available context (screenshots, transcripts, insights).
 */

import { Baleybot, Output, anthropic } from '@baleybots/core';
import { QAResponseSchema, type SessionContext, type QAResponse } from './types';

const SYSTEM_PROMPT = `You are a helpful assistant that answers questions about a work session.

You have access to:
- A rolling summary of the session
- Recent screenshots with analysis
- Audio transcripts (if available)
- Generated insights

Answer questions naturally and helpfully. If you can reference specific moments or screenshots, do so.
If you don't have enough information to answer, say so honestly.

Keep responses concise but informative.`;

export function createQABot() {
  return Baleybot.create({
    name: 'qa-bot',
    goal: SYSTEM_PROMPT,
    model: anthropic('claude-sonnet-4-20250514', {
      proxyUrl: '', // Disable proxy - use direct URLs with our custom fetch
    }),
    output: Output.object({ schema: QAResponseSchema }),
  });
}

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

export type { QAResponse };
