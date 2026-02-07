/**
 * Session Intelligence Bots - Streamlined API
 *
 * Exports types, input builders, pipeline factories, and config utilities.
 * All pipeline execution happens in the AI Worker (off main thread).
 */

// Types (includes all Zod schemas and inferred types)
export * from './types';

// Input builders (used by the worker via dynamic import)
export * from './input-builders';

// Pipeline factories (used by the worker via dynamic import)
export {
  BOT_DEFINITIONS,
  createActivityDetectorPipeline,
  createSummarizerPipeline,
  createAnalysisControllerPipeline,
  createQABotPipeline,
  createFinalSummaryPipeline,
  createCapturePipeline,
  createSessionNarratorPipeline,
  resetPipelines,
} from './pipelines';

// Config utilities (used by Settings and components)
export {
  updateApiKeys,
  hasApiKey,
  testApiKey,
  type BotConfig,
} from './config';
