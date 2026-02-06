/**
 * Pipeline Factory
 *
 * Factory functions that compile BAL definitions into Pipeline instances.
 * Uses lazy initialization with a single cache map.
 */

import { Pipeline } from '@baleybots/tools';
import { BOT_DEFINITIONS } from './definitions';

// Model configuration
const MODELS = {
  default: 'claude-sonnet-4-20250514',
  capture: 'claude-sonnet-4-20250514',
} as const;

type PipelineName = keyof typeof BOT_DEFINITIONS;

// Pipeline config: definition key → [display name, model]
const PIPELINE_CONFIG: Record<PipelineName, [string, string]> = {
  activityDetector: ['activity-detector', MODELS.default],
  summarizer: ['summarizer', MODELS.default],
  analysisController: ['analysis-controller', MODELS.default],
  qaBot: ['qa-bot', MODELS.default],
  finalSummary: ['final-summary', MODELS.default],
  capture: ['capture', MODELS.capture],
  captureTiming: ['capture-timing', MODELS.default],
};

const cache = new Map<PipelineName, Pipeline>();

function getPipeline(name: PipelineName): Pipeline {
  let pipeline = cache.get(name);
  if (!pipeline) {
    const [displayName, model] = PIPELINE_CONFIG[name];
    try {
      pipeline = Pipeline.from(BOT_DEFINITIONS[name], { model });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to compile ${displayName} pipeline: ${message}`);
    }
    cache.set(name, pipeline);
  }
  return pipeline;
}

export const createActivityDetectorPipeline = () => getPipeline('activityDetector');
export const createSummarizerPipeline = () => getPipeline('summarizer');
export const createAnalysisControllerPipeline = () => getPipeline('analysisController');
export const createQABotPipeline = () => getPipeline('qaBot');
export const createFinalSummaryPipeline = () => getPipeline('finalSummary');
export const createCapturePipeline = () => getPipeline('capture');
export const createCaptureTimingPipeline = () => getPipeline('captureTiming');

/** Reset all cached pipelines (for testing or when API keys change) */
export function resetPipelines(): void {
  cache.clear();
}
