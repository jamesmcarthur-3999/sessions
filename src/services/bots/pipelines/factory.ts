/**
 * Pipeline Factory
 *
 * Factory functions that compile BAL definitions into Pipeline instances.
 * Uses lazy initialization with a single cache map.
 */

import { Pipeline } from '@baleybots/tools';
import { Baleybot } from '@baleybots/core';
import { BOT_DEFINITIONS } from './definitions';

// Model configuration
const MODELS = {
  /** Sonnet 4.5 — best quality-to-cost for user-facing output */
  default: 'claude-sonnet-4-5-20250929',
  /** Haiku 4.5 — fast + cheap for high-volume classification */
  fast: 'claude-haiku-4-5-20251001',
} as const;

type PipelineName = keyof typeof BOT_DEFINITIONS;

// Pipeline config: definition key → [display name, model]
const PIPELINE_CONFIG: Record<PipelineName, [string, string]> = {
  activityDetector: ['activity-detector', MODELS.fast],       // runs every 10-60s, classification
  summarizer: ['summarizer', MODELS.default],                 // user-facing rolling summary
  analysisController: ['analysis-controller', MODELS.fast],   // ambient vs deep classification
  qaBot: ['qa-bot', MODELS.default],                          // user-facing chat
  finalSummary: ['final-summary', MODELS.default],            // user-facing end-of-session summary
  capture: ['capture', MODELS.default],                       // user-facing quick capture
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

export function createActivityDetectorPipeline(): Pipeline { return getPipeline('activityDetector'); }
export function createSummarizerPipeline(): Pipeline { return getPipeline('summarizer'); }
export function createAnalysisControllerPipeline(): Pipeline { return getPipeline('analysisController'); }
export function createQABotPipeline(): Pipeline { return getPipeline('qaBot'); }
export function createFinalSummaryPipeline(): Pipeline { return getPipeline('finalSummary'); }
export function createCapturePipeline(): Pipeline { return getPipeline('capture'); }

// Transcriber uses Baleybot.create() (not BAL Pipeline) — transcription is a provider-level operation
let transcriberBot: Baleybot | null = null;

export function createTranscriberBot(): Baleybot {
  if (!transcriberBot) {
    transcriberBot = Baleybot.create({
      name: 'transcriber',
      goal: 'Transcribe audio input',
      model: 'gpt-4o-transcribe',
    });
  }
  return transcriberBot;
}

/** Reset all cached pipelines (for testing or when API keys change) */
export function resetPipelines(): void {
  cache.clear();
  transcriberBot = null;
}
