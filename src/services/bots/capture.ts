/**
 * Capture Bot
 *
 * Processes quick captures (text, pasted content) and extracts
 * structured information: title, summary, tasks, and notes.
 */

import { Baleybot } from '@baleybots/core';
import { CaptureResultSchema, type CaptureResult } from './types';

const SYSTEM_PROMPT = `You are an AI assistant that analyzes captured text and extracts structured information.

Your job is to:
1. Create a concise, descriptive title (2-6 words)
2. Write a brief summary paragraph capturing the essence
3. Extract actionable tasks (things to do, follow up on)
4. Extract key notes or insights worth remembering

Guidelines:
- Be concise but insightful
- Tasks should be clear and actionable (start with verbs)
- Notes should capture important information or insights
- If there are no clear tasks, return an empty array
- Same for notes - only include if there's something worth noting
- Look for implicit tasks: TODOs, FIXMEs, "need to", "should", "must", etc.`;

export function createCaptureBot() {
  return Baleybot.create({
    name: 'capture',
    goal: SYSTEM_PROMPT,
    model: 'claude-sonnet-4-20250514',
    outputSchema: CaptureResultSchema,
  });
}

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

export type { CaptureResult };
