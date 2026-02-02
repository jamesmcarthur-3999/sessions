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

// Q&A response
export const QAResponseSchema = z.object({
  answer: z.string(),
  relevantMoments: z.array(z.object({
    timestamp: z.string(),
    description: z.string(),
  })).optional(),
  suggestedFollowUp: z.string().nullable(),
});

export type QAResponse = z.infer<typeof QAResponseSchema>;

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
