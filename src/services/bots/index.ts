/**
 * Session Intelligence Bots - Streamlined API
 *
 * Exports types, input builders, pipeline factories, and config utilities.
 */

// Types (includes all Zod schemas and inferred types)
export * from './types';

// Input builders (consolidated from individual bot files)
export * from './input-builders';

// Pipeline factories (use these directly - they handle caching internally)
export {
  BOT_DEFINITIONS,
  createActivityDetectorPipeline,
  createSummarizerPipeline,
  createAnalysisControllerPipeline,
  createQABotPipeline,
  createFinalSummaryPipeline,
  createCapturePipeline,
  createCaptureTimingPipeline,
  resetPipelines,
} from './pipelines';

// Config utilities
export {
  initializeBots,
  updateApiKeys,
  isBotsReady,
  hasApiKey,
  resetBots,
  testApiKey,
  type BotConfig,
} from './config';
