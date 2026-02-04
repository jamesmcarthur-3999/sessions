/**
 * Activity Detector Bot
 *
 * Analyzes screenshots to detect what the user is doing,
 * identify context changes, and suggest insights.
 */

import { Baleybot, Output, combine, text, image, anthropic } from '@baleybots/core';
import { ActivityDetectionSchema, type ActivityDetection } from './types';

const SYSTEM_PROMPT = `You are an activity detector analyzing screenshots from a work session.

For each screenshot, determine:
1. Has there been a significant change from the previous context?
2. What application/website is being used?
3. What is the user's current context (e.g., "editing React component", "reading documentation")
4. What type of activity is this?
5. Should we generate an insight card? Only if something notable happened.

Be concise but specific. Focus on what's useful for understanding the work session.`;

export function createActivityDetectorBot() {
  return Baleybot.create({
    name: 'activity-detector',
    goal: SYSTEM_PROMPT,
    model: anthropic('claude-sonnet-4-20250514', {
      proxyUrl: '', // Disable proxy - use direct URLs with our custom fetch
    }),
    output: Output.object({ schema: ActivityDetectionSchema }),
  });
}

export function buildActivityDetectorInput(
  screenshotBase64: string,
  previousContext?: string
) {
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
      mediaType: 'image/png',
    })
  );
}

export type { ActivityDetection };
