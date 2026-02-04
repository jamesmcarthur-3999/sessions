/**
 * Capture Bot
 *
 * Processes quick captures (text, pasted content) and extracts
 * structured information: title, summary, tasks, and notes.
 */

import { Baleybot, Output, anthropic } from '@baleybots/core';
import { z } from 'zod';

// Schema for structured output - arrays of strings (what models naturally return)
const CaptureSchema = z.object({
  title: z.string().describe('A concise 2-6 word title for the capture'),
  summary: z.string().describe('A brief paragraph summarizing the captured content'),
  tasks: z.array(z.string()).describe('Action items as clear, actionable strings (start with verbs)'),
  notes: z.array(z.string()).describe('Key insights or notes worth remembering'),
});

export type CaptureResult = z.infer<typeof CaptureSchema>;

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

export async function createCaptureBot() {
  // API key is set via setDefaultApiKey in config.ts
  // Custom fetch (Tauri or browser) is set via setGlobalConfig
  return Baleybot.create({
    name: 'capture',
    goal: SYSTEM_PROMPT,
    model: anthropic('claude-sonnet-4-5-20250929', {
      proxyUrl: '', // Disable proxy - use direct URLs with our custom fetch
    }),
    output: Output.object({ schema: CaptureSchema }), // v6 BAL pattern
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

// CaptureResult already exported above via z.infer
