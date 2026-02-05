/**
 * Pipeline Factory
 *
 * Factory functions that compile BAL definitions into Pipeline instances.
 * Uses lazy initialization with caching to avoid redundant compilation.
 */

import { Pipeline } from '@baleybots/tools';
import { BOT_DEFINITIONS } from './definitions';

// Model configuration
// Note: Use model name without provider prefix - Baleybots determines provider from API key config
const MODELS = {
  // Standard model for most bots - Claude 4 Sonnet
  default: 'claude-sonnet-4-20250514',
  // Use same model for capture to ensure consistency
  capture: 'claude-sonnet-4-20250514',
} as const;

// Cached pipeline instances
let activityDetectorPipeline: Pipeline | null = null;
let summarizerPipeline: Pipeline | null = null;
let analysisControllerPipeline: Pipeline | null = null;
let qaBotPipeline: Pipeline | null = null;
let finalSummaryPipeline: Pipeline | null = null;
let capturePipeline: Pipeline | null = null;
let captureTimingPipeline: Pipeline | null = null;

/**
 * Helper to compile a pipeline with proper error handling
 */
function compilePipeline(name: string, definition: string, model: string): Pipeline {
  try {
    return Pipeline.from(definition, { model });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to compile ${name} pipeline: ${message}`);
  }
}

/**
 * Create or return cached Activity Detector pipeline
 */
export function createActivityDetectorPipeline(): Pipeline {
  if (!activityDetectorPipeline) {
    activityDetectorPipeline = compilePipeline(
      'activity-detector',
      BOT_DEFINITIONS.activityDetector,
      MODELS.default
    );
  }
  return activityDetectorPipeline;
}

/**
 * Create or return cached Summarizer pipeline
 */
export function createSummarizerPipeline(): Pipeline {
  if (!summarizerPipeline) {
    summarizerPipeline = compilePipeline(
      'summarizer',
      BOT_DEFINITIONS.summarizer,
      MODELS.default
    );
  }
  return summarizerPipeline;
}

/**
 * Create or return cached Analysis Controller pipeline
 */
export function createAnalysisControllerPipeline(): Pipeline {
  if (!analysisControllerPipeline) {
    analysisControllerPipeline = compilePipeline(
      'analysis-controller',
      BOT_DEFINITIONS.analysisController,
      MODELS.default
    );
  }
  return analysisControllerPipeline;
}

/**
 * Create or return cached Q&A Bot pipeline
 */
export function createQABotPipeline(): Pipeline {
  if (!qaBotPipeline) {
    qaBotPipeline = compilePipeline(
      'qa-bot',
      BOT_DEFINITIONS.qaBot,
      MODELS.default
    );
  }
  return qaBotPipeline;
}

/**
 * Create or return cached Final Summary pipeline
 */
export function createFinalSummaryPipeline(): Pipeline {
  if (!finalSummaryPipeline) {
    finalSummaryPipeline = compilePipeline(
      'final-summary',
      BOT_DEFINITIONS.finalSummary,
      MODELS.default
    );
  }
  return finalSummaryPipeline;
}

/**
 * Create or return cached Capture pipeline
 */
export function createCapturePipeline(): Pipeline {
  if (!capturePipeline) {
    capturePipeline = compilePipeline(
      'capture',
      BOT_DEFINITIONS.capture,
      MODELS.capture
    );
  }
  return capturePipeline;
}

/**
 * Create or return cached Capture Timing pipeline
 * This bot decides when to take the next screenshot based on activity analysis
 */
export function createCaptureTimingPipeline(): Pipeline {
  if (!captureTimingPipeline) {
    captureTimingPipeline = compilePipeline(
      'capture-timing',
      BOT_DEFINITIONS.captureTiming,
      MODELS.default
    );
  }
  return captureTimingPipeline;
}

/**
 * Reset all cached pipelines (useful for testing or when API keys change)
 */
export function resetPipelines(): void {
  activityDetectorPipeline = null;
  summarizerPipeline = null;
  analysisControllerPipeline = null;
  qaBotPipeline = null;
  finalSummaryPipeline = null;
  capturePipeline = null;
  captureTimingPipeline = null;
}
