/**
 * Session Intelligence Bots
 *
 * Export all bots and their utilities.
 */

export * from './types';
export { createSummarizerBot, buildSummarizerInput } from './summarizer';
export { createActivityDetectorBot, buildActivityDetectorInput } from './activity-detector';
export { createAnalysisControllerBot, buildAnalysisControllerInput, type ActivityMetrics } from './analysis-controller';
export { createQABot, buildQAInput } from './qa-bot';
export { createFinalSummaryBot, buildFinalSummaryInput, type FinalSummaryInput } from './final-summary';
export { createCaptureBot, buildCaptureInput } from './capture';
export {
  initializeBots,
  updateApiKeys,
  isBotsReady,
  hasApiKey,
  resetBots,
  type BotConfig,
} from './config';
