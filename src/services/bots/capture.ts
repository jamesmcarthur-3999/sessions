/**
 * Capture Bot
 *
 * Processes quick captures (text, pasted content) and extracts
 * structured information: title, summary, tasks, and notes.
 *
 * Uses @ai-sdk/anthropic directly for browser compatibility
 * (Baleybots requires a proxy server in browser mode).
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { CaptureResultSchema, type CaptureResult } from './types';
import { getSecureItem } from '../secure-storage';
import { isTauri } from '../recording';

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

/**
 * Process a capture using the Anthropic API directly
 */
export async function processCapture(input: string): Promise<CaptureResult> {
  // Get API key from secure storage or localStorage
  let apiKey = await getSecureItem('sessions_api_key');
  if (!apiKey && !isTauri()) {
    apiKey = localStorage.getItem('sessions_api_key');
  }

  if (!apiKey) {
    throw new Error('No API key configured. Please add your Claude API key in Settings.');
  }

  // Create Anthropic provider with browser access header
  const anthropic = createAnthropic({
    apiKey,
    headers: {
      'anthropic-dangerous-direct-browser-access': 'true',
    },
  });

  // Generate structured output
  const { object } = await generateObject({
    model: anthropic('claude-3-5-sonnet-20241022'),
    schema: CaptureResultSchema,
    system: SYSTEM_PROMPT,
    prompt: input,
  });

  return object;
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
