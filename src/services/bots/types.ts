/**
 * Bot Types for Session Intelligence
 */

import { z } from 'zod';

// Activity detection output
export const ActivityDetectionSchema = z.object({
  hasSignificantChange: z.boolean(),
  currentApp: z.string().nullable(),
  currentContext: z.string(),
  activityType: z.enum(['coding', 'writing', 'browsing', 'designing', 'meeting', 'reading', 'unknown']),
  suggestedInsight: z.string().nullable(),
});

export type ActivityDetection = z.infer<typeof ActivityDetectionSchema>;

// Summary output
export const RollingSummarySchema = z.object({
  summary: z.string(),
  keyMoments: z.array(z.string()),
  currentFocus: z.string(),
});

export type RollingSummary = z.infer<typeof RollingSummarySchema>;

// Analysis mode decision
export const AnalysisModeDecisionSchema = z.object({
  recommendedMode: z.enum(['ambient', 'deep']),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
});

export type AnalysisModeDecision = z.infer<typeof AnalysisModeDecisionSchema>;

// Q&A response - using string array for relevantMoments for v6 compatibility
export const QAResponseSchema = z.object({
  answer: z.string(),
  relevantMoments: z.array(z.string()).optional().describe('Relevant moments from the session, formatted as "HH:MM: description"'),
  suggestedFollowUp: z.string().nullable(),
});

export type QAResponse = z.infer<typeof QAResponseSchema>;

// Final summary output (matches app's Summary type)
// Uses arrays of strings for v6 Output pattern compatibility
export const FinalSummarySchema = z.object({
  text: z.string().describe('A comprehensive 2-4 paragraph summary of the entire session'),
  tasks: z.array(z.string()).describe('Action items extracted from the session'),
  notes: z.array(z.string()).describe('Important observations and insights'),
});

export type FinalSummary = z.infer<typeof FinalSummarySchema>;

// Capture output (for QuickCapture)
export const CaptureSchema = z.object({
  title: z.string().describe('A concise 2-6 word title for the capture'),
  summary: z.string().describe('A brief paragraph summarizing the captured content'),
  tasks: z.array(z.string()).describe('Action items as clear, actionable strings (start with verbs)'),
  notes: z.array(z.string()).describe('Key insights or notes worth remembering'),
});

export type CaptureResult = z.infer<typeof CaptureSchema>;

// Capture timing decision (AI-driven adaptive capture)
export const CaptureTimingSchema = z.object({
  recommendedWaitSeconds: z.number().min(5).max(180),
  reason: z.string(),
  activityLevel: z.enum(['high', 'medium', 'low']),
});

export type CaptureTimingDecision = z.infer<typeof CaptureTimingSchema>;

// Session context for bots
export interface SessionContext {
  sessionId: string;
  rollingSummary: string;
  recentScreenshots: Array<{
    id: string;
    capturedAt: string;
    appName: string | null;
    windowTitle: string | null;
    analysis: string | null;
  }>;
  recentTranscripts: string[];
  recentInsights: string[];
  durationSeconds: number;
  analysisMode: 'ambient' | 'deep';
}
