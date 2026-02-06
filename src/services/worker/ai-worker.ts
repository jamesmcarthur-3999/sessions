/**
 * AI Worker - Runs Baleybots pipelines off the main thread.
 *
 * Handles pipeline compilation/caching, retry with exponential backoff,
 * rate limiting, multimodal input builders, and output schema validation.
 * Uses native fetch with 'anthropic-dangerous-direct-browser-access' header.
 */

/// <reference lib="webworker" />

import type {
  WorkerMessage,
  WorkerResponse,
} from './types';
import type {
  ActivityDetection,
  RollingSummary,
  AnalysisModeDecision,
  QAResponse,
  FinalSummary,
} from '../bots/types';
import { MessageQueue } from './message-queue';
import { WorkerStateMachine } from './worker-state';
import type { WorkerState } from './worker-state';

// ============================================================================
// State
// ============================================================================

const stateMachine = new WorkerStateMachine();
const messageQueue = new MessageQueue<WorkerMessage>();

let anthropicKey: string | null = null;
let openaiKey: string | null = null;

// Baleybots module - loaded dynamically
let baleybots: typeof import('@baleybots/core') | null = null;
let botsModule: typeof import('../bots') | null = null;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Helper type to create a union of all WorkerResponse variants without timestamp.
 * This preserves the discriminated union structure.
 */
type SendableResponse = {
  [K in WorkerResponse['type']]: Omit<Extract<WorkerResponse, { type: K }>, 'timestamp'>
}[WorkerResponse['type']];

function send(message: SendableResponse): void {
  const fullMessage = { ...message, timestamp: Date.now() } as WorkerResponse;
  self.postMessage(fullMessage);
}

function log(level: 'info' | 'warn' | 'error', message: string): void {
  send({ type: 'log', level, message });
}

function emitStateChange(from: WorkerState, to: WorkerState, reason?: string): void {
  send({ type: 'state-change', from, to, reason });
}

/**
 * Transition state and emit change event
 */
function transitionState(to: WorkerState, reason?: string): boolean {
  const from = stateMachine.getState();
  const success = stateMachine.tryTransitionTo(to, reason);
  if (success) {
    emitStateChange(from, to, reason);
  }
  return success;
}

/**
 * Retry wrapper using baleybots' withRetry when available, else fallback
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  initialDelayMs = 1000
): Promise<T> {
  // Try to use baleybots' withRetry if available
  if (baleybots && 'withRetry' in baleybots) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (baleybots as any).withRetry(operation, {
      maxRetries,
      initialDelayMs,
      onRetry: (error: Error, attempt: number, delayMs: number) => {
        log('warn', `Retrying operation (attempt ${attempt}) in ${delayMs}ms: ${error.message}`);
      },
    });
    if (result.success) {
      return result.value;
    }
    throw result.error || new Error('Operation failed after retries');
  }

  // Fallback retry logic
  let lastError: Error | null = null;
  let delay = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const message = lastError.message.toLowerCase();

      // Only retry on rate limits or temporary errors
      if (
        message.includes('rate') ||
        message.includes('429') ||
        message.includes('overloaded') ||
        message.includes('timeout')
      ) {
        if (attempt < maxRetries) {
          log('warn', `Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2;
          continue;
        }
      }

      throw lastError;
    }
  }

  throw lastError || new Error('Operation failed after retries');
}

/**
 * Configure API keys in baleybots (shared by init + updateApiKeys)
 */
function configureApiKeys(): void {
  if (!baleybots) return;

  baleybots.Baleybot.setGlobalConfig({
    anthropic: {
      apiKey: anthropicKey ?? undefined,
      headers: {
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    },
    openai: {
      apiKey: openaiKey ?? undefined,
    },
  });

  if (anthropicKey) {
    baleybots.setDefaultApiKey('anthropic', anthropicKey);
  }
  if (openaiKey) {
    baleybots.setDefaultApiKey('openai', openaiKey);
  }
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Bootstrap the worker - loads modules but doesn't set keys
 * Called automatically on worker start
 */
async function bootstrap(): Promise<void> {
  if (!transitionState('BOOTSTRAPPING', 'Starting bootstrap')) {
    log('error', 'Cannot bootstrap - invalid state');
    return;
  }

  try {
    // Import Baleybots core
    baleybots = await import('@baleybots/core');

    // Import bots module (pipelines, input builders)
    botsModule = await import('../bots');

    // Transition to READY
    if (!transitionState('READY', 'Bootstrap complete')) {
      throw new Error('Failed to transition to READY state');
    }

    // Signal ready to main thread
    send({ type: 'ready' });
    log('info', 'AI Worker bootstrapped, waiting for API keys');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log('error', `Failed to bootstrap worker: ${errorMsg}`);
    transitionState('ERROR', `Bootstrap failed: ${errorMsg}`);
    send({ type: 'error', sessionId: '', error: `Worker bootstrap failed: ${errorMsg}` });
  }
}

/**
 * Initialize with API keys and environment config
 */
async function init(msg: Extract<WorkerMessage, { type: 'init' }>): Promise<void> {
  if (!baleybots) {
    log('error', 'Cannot init - worker not bootstrapped');
    send({ type: 'error', sessionId: '', error: 'Worker not bootstrapped', requestId: msg.id });
    return;
  }

  if (!transitionState('INITIALIZING', 'Starting initialization')) {
    log('error', 'Cannot init - invalid state');
    return;
  }

  try {
    anthropicKey = msg.anthropicKey;
    openaiKey = msg.openaiKey;

    // Diagnostic logging - show key status without exposing actual keys
    log('info', `API keys received: anthropic=${anthropicKey ? 'set (' + anthropicKey.length + ' chars)' : 'NOT SET'}, openai=${openaiKey ? 'set (' + openaiKey.length + ' chars)' : 'NOT SET'}`);

    configureApiKeys();
    log('info', 'API keys configured');

    if (!transitionState('INITIALIZED', 'Initialization complete')) {
      throw new Error('Failed to transition to INITIALIZED state');
    }

    log('info', 'AI Worker initialized');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log('error', `Failed to initialize worker: ${errorMsg}`);
    transitionState('ERROR', `Init failed: ${errorMsg}`);
    send({ type: 'error', sessionId: '', error: `Worker init failed: ${errorMsg}`, requestId: msg.id });
  }
}

function isReady(): boolean {
  return stateMachine.isReady() && !!anthropicKey && !!botsModule;
}

// ============================================================================
// Helpers - Binary Conversion
// ============================================================================

/**
 * Convert ArrayBuffer to base64 data URL
 * Uses chunked btoa() to avoid O(n^2) string concatenation
 */
function arrayBufferToBase64(buffer: ArrayBuffer, mimeType: string): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    chunks.push(String.fromCharCode(...slice));
  }
  const base64 = btoa(chunks.join(''));
  return `data:${mimeType};base64,${base64}`;
}

// ============================================================================
// Screenshot Analysis
// ============================================================================

async function analyzeScreenshot(
  msg: Extract<WorkerMessage, { type: 'analyze-screenshot' }>
): Promise<void> {
  const { sessionId, screenshotId, imageBase64, previousAnalysis, id } = msg;

  if (!botsModule) {
    send({
      type: 'analysis-complete',
      id,
      sessionId,
      screenshotId,
      analysis: null,
      error: 'Worker not initialized',
    });
    return;
  }

  if (!isReady()) {
    send({
      type: 'analysis-complete',
      id,
      sessionId,
      screenshotId,
      analysis: null,
      error: 'No API key configured',
    });
    return;
  }

  // Track that we're processing
  transitionState('PROCESSING', 'Analyzing screenshot');

  try {
    log('info', `Analyzing screenshot ${screenshotId}...`);

    // Build multimodal input
    const input = botsModule.buildActivityDetectorInput(imageBase64, previousAnalysis || undefined);

    // Run through Baleybots pipeline with retry
    const result = (await withRetry(() =>
      botsModule!.createActivityDetectorPipeline().process(input)
    )) as unknown as ActivityDetection | null;

    // Validate response
    if (!result || typeof result !== 'object') {
      log('error', `Invalid activity bot response: ${JSON.stringify(result)}`);
      send({
        type: 'analysis-complete',
        id,
        sessionId,
        screenshotId,
        analysis: null,
        error: 'Invalid response from activity detector',
      });
      transitionState('INITIALIZED', 'Analysis failed - invalid response');
      return;
    }

    // Send result back to main thread
    send({
      type: 'analysis-complete',
      id,
      sessionId,
      screenshotId,
      analysis: result,
    });

    // Create insight if suggested
    if (result.suggestedInsight) {
      send({
        type: 'insight-created',
        sessionId,
        insightType: 'moment',
        content: result.suggestedInsight,
      });
    }

    // If significant change, request summary update
    if (result.hasSignificantChange) {
      send({ type: 'request-summary-update', sessionId });
    }

    log('info', `Screenshot ${screenshotId} analyzed: ${result.currentContext?.substring(0, 50)}...`);
    transitionState('INITIALIZED', 'Analysis complete');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Screenshot analysis failed: ${message}`);
    send({
      type: 'analysis-complete',
      id,
      sessionId,
      screenshotId,
      analysis: null,
      error: message,
    });
    transitionState('INITIALIZED', 'Analysis failed - error');
  }
}

// ============================================================================
// Binary Screenshot Analysis (Zero-Copy Transfer)
// ============================================================================

async function analyzeScreenshotBinary(
  msg: Extract<WorkerMessage, { type: 'analyze-screenshot-binary' }>
): Promise<void> {
  const { imageData } = msg;

  // Detect image type from magic bytes
  const bytes = new Uint8Array(imageData);
  let mimeType = 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    mimeType = 'image/png';
  }

  // Convert to base64 for the API (Baleybots expects base64)
  const imageBase64 = arrayBufferToBase64(imageData, mimeType);

  // Reuse existing analysis logic
  return analyzeScreenshot({
    ...msg,
    type: 'analyze-screenshot',
    imageBase64,
  });
}

// ============================================================================
// Binary Audio Transcription (Zero-Copy Transfer)
// ============================================================================

async function transcribeAudioBinary(
  msg: Extract<WorkerMessage, { type: 'transcribe-audio-binary' }>
): Promise<void> {
  const { sessionId, chunkId, audioData, id } = msg;

  if (!openaiKey) {
    send({ type: 'error', id, sessionId, error: 'OpenAI API key not configured for transcription' });
    return;
  }

  if (!botsModule) {
    send({ type: 'error', id, sessionId, error: 'Worker not initialized' });
    return;
  }

  transitionState('PROCESSING', 'Transcribing audio (binary)');

  try {
    send({ type: 'transcription-start', sessionId });

    const input = botsModule.buildTranscriberInput(audioData);
    const text = (await withRetry(() =>
      botsModule!.createTranscriberBot().process(input)
    )) as unknown as string;

    send({ type: 'transcription-complete', id, sessionId, chunkId, text: text || '' });
    log('info', `Transcribed (binary): ${(text || '').substring(0, 50)}...`);

    if (text?.trim()) {
      send({ type: 'request-summary-update', sessionId });
    }

    transitionState('INITIALIZED', 'Transcription complete');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Transcription failed: ${message}`);
    send({ type: 'error', id, sessionId, error: `Audio transcription failed: ${message}` });
    transitionState('INITIALIZED', 'Transcription failed');
  }
}

// ============================================================================
// Summary Updates
// ============================================================================

async function updateSummary(
  msg: Extract<WorkerMessage, { type: 'update-summary' }>
): Promise<void> {
  const { sessionId, context, id } = msg;

  if (!botsModule || !isReady()) {
    log('info', 'Skipping summary update - not ready');
    return;
  }

  transitionState('PROCESSING', 'Updating summary');

  try {
    const input = botsModule.buildSummarizerInput(context);

    const result = (await withRetry(() =>
      botsModule!.createSummarizerPipeline().process(input)
    )) as unknown as RollingSummary | null;

    if (result?.summary) {
      send({
        type: 'summary-updated',
        id,
        sessionId,
        summary: result.summary,
        keyMoments: result.keyMoments || [],
        currentFocus: result.currentFocus || '',
      });
    }

    transitionState('INITIALIZED', 'Summary update complete');
  } catch (error) {
    log('error', `Summary update failed: ${error}`);
    send({
      type: 'error',
      id,
      sessionId,
      error: 'AI summary update failed',
    });
    transitionState('INITIALIZED', 'Summary update failed');
  }
}

// ============================================================================
// Analysis Mode Check
// ============================================================================

async function checkAnalysisMode(
  msg: Extract<WorkerMessage, { type: 'check-analysis-mode' }>
): Promise<void> {
  const { sessionId, context, metrics } = msg;

  if (!botsModule || !isReady()) {
    return;
  }

  transitionState('PROCESSING', 'Checking analysis mode');

  try {
    const input = botsModule.buildAnalysisControllerInput(context, metrics);

    const result = (await withRetry(() =>
      botsModule!.createAnalysisControllerPipeline().process(input)
    )) as unknown as AnalysisModeDecision | null;

    if (
      result &&
      typeof result.confidence === 'number' &&
      result.recommendedMode &&
      result.confidence > 0.7 &&
      result.recommendedMode !== context.analysisMode
    ) {
      send({
        type: 'mode-changed',
        sessionId,
        mode: result.recommendedMode,
        reason: result.reason || 'Mode adjustment based on activity',
      });
    }

    transitionState('INITIALIZED', 'Analysis mode check complete');
  } catch (error) {
    log('error', `Analysis mode check failed: ${error}`);
    transitionState('INITIALIZED', 'Analysis mode check failed');
  }
}

// ============================================================================
// Chat / Q&A
// ============================================================================

async function handleChat(
  msg: Extract<WorkerMessage, { type: 'chat' }>
): Promise<void> {
  const { requestId, message, context, id } = msg;

  if (!botsModule || !isReady()) {
    send({
      type: 'chat-response',
      id,
      requestId,
      response: 'I need an API key to answer questions. Please configure your Claude API key in Settings.',
    });
    return;
  }

  transitionState('PROCESSING', 'Processing chat');

  try {
    const input = botsModule.buildQAInput(message, context);

    const result = (await withRetry(() =>
      botsModule!.createQABotPipeline().process(input)
    )) as unknown as QAResponse | null;

    send({
      type: 'chat-response',
      id,
      requestId,
      response: result?.answer || 'Sorry, I was unable to generate a response. Please try again.',
    });

    transitionState('INITIALIZED', 'Chat complete');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    send({
      type: 'chat-response',
      id,
      requestId,
      response: `Error: ${errorMsg}`,
    });
    transitionState('INITIALIZED', 'Chat failed');
  }
}

// ============================================================================
// Final Summary Generation
// ============================================================================

async function generateFinalSummary(
  msg: Extract<WorkerMessage, { type: 'generate-final-summary' }>
): Promise<void> {
  const { id } = msg;

  if (!botsModule || !isReady()) {
    send({
      type: 'final-summary-complete',
      id,
      text: null,
      tasks: [],
      notes: [],
      error: !botsModule ? 'Worker not initialized' : 'No API key configured',
    });
    return;
  }

  transitionState('PROCESSING', 'Generating final summary');

  try {
    log('info', 'Generating final summary...');

    const input = botsModule.buildFinalSummaryInput({
      rollingSummary: msg.rollingSummary,
      insights: msg.insights,
      audioChunks: msg.audioChunks,
      screenshots: msg.screenshots,
      durationSeconds: msg.durationSeconds,
      title: msg.title,
    });

    const result = (await withRetry(() =>
      botsModule!.createFinalSummaryPipeline().process(input)
    )) as unknown as FinalSummary | null;

    send({
      type: 'final-summary-complete',
      id,
      text: result?.text ?? null,
      tasks: result?.tasks ?? [],
      notes: result?.notes ?? [],
    });

    log('info', `Final summary generated: ${result?.text?.substring(0, 50) ?? 'no text'}...`);
    transitionState('INITIALIZED', 'Final summary complete');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Final summary generation failed: ${message}`);
    send({
      type: 'final-summary-complete',
      id,
      text: null,
      tasks: [],
      notes: [],
      error: message,
    });
    transitionState('INITIALIZED', 'Final summary failed');
  }
}

// ============================================================================
// Quick Capture Processing
// ============================================================================

async function processCapture(
  msg: Extract<WorkerMessage, { type: 'process-capture' }>
): Promise<void> {
  const { text, attachmentDescriptions, id } = msg;

  if (!botsModule || !isReady()) {
    send({
      type: 'capture-complete',
      id,
      title: null,
      summary: null,
      tasks: [],
      notes: [],
      error: !botsModule ? 'Worker not initialized' : 'No API key configured',
    });
    return;
  }

  transitionState('PROCESSING', 'Processing capture');

  try {
    log('info', 'Processing capture...');

    const input = botsModule.buildCaptureInput(text, attachmentDescriptions);

    const result = (await withRetry(() =>
      botsModule!.createCapturePipeline().process(input)
    )) as unknown as { title?: string; summary?: string; tasks?: string[]; notes?: string[] } | null;

    send({
      type: 'capture-complete',
      id,
      title: result?.title ?? null,
      summary: result?.summary ?? null,
      tasks: result?.tasks ?? [],
      notes: result?.notes ?? [],
    });

    log('info', `Capture processed: ${result?.title ?? 'no title'}`);
    transitionState('INITIALIZED', 'Capture complete');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Capture processing failed: ${message}`);
    send({
      type: 'capture-complete',
      id,
      title: null,
      summary: null,
      tasks: [],
      notes: [],
      error: message,
    });
    transitionState('INITIALIZED', 'Capture failed');
  }
}

// ============================================================================
// API Key Updates
// ============================================================================

async function updateApiKeys(
  msg: Extract<WorkerMessage, { type: 'update-api-keys' }>
): Promise<void> {
  const { id } = msg;

  try {
    anthropicKey = msg.anthropicKey;
    openaiKey = msg.openaiKey;

    configureApiKeys();

    // Reset cached pipelines so they pick up new config
    if (botsModule) {
      botsModule.resetPipelines();
    }

    log('info', 'API keys updated');
    send({ type: 'api-keys-updated', id, success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `API key update failed: ${message}`);
    send({ type: 'api-keys-updated', id, success: false, error: message });
  }
}

// ============================================================================
// Message Handler
// ============================================================================

/**
 * Process a single message
 * Called sequentially by MessageQueue (fixes C2 race condition)
 */
async function handleMessage(msg: WorkerMessage): Promise<void> {
  switch (msg.type) {
    case 'init':
      await init(msg);
      break;

    case 'analyze-screenshot':
      await analyzeScreenshot(msg);
      break;

    case 'analyze-screenshot-binary':
      await analyzeScreenshotBinary(msg);
      break;

    case 'transcribe-audio-binary':
      await transcribeAudioBinary(msg);
      break;

    case 'update-summary':
      await updateSummary(msg);
      break;

    case 'check-analysis-mode':
      await checkAnalysisMode(msg);
      break;

    case 'chat':
      await handleChat(msg);
      break;

    case 'generate-final-summary':
      await generateFinalSummary(msg);
      break;

    case 'process-capture':
      await processCapture(msg);
      break;

    case 'update-api-keys':
      await updateApiKeys(msg);
      break;

    case 'set-analysis-mode':
      send({
        type: 'mode-changed',
        id: msg.id,
        sessionId: msg.sessionId,
        mode: msg.mode,
        reason: 'Manual override',
      });
      break;

    case 'stop':
      log('info', 'Worker stopping');
      transitionState('TERMINATED', 'Stop requested');
      break;
  }
}

// Configure message queue
messageQueue.setHandler(handleMessage);
messageQueue.setErrorHandler((error, msg) => {
  log('error', `Message handler error for ${msg.type}: ${error.message}`);
  send({ type: 'error', sessionId: '', error: error.message });
});

// Main message receiver - enqueues messages for sequential processing
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  messageQueue.enqueue(event.data);
};

// Bootstrap immediately when worker starts
bootstrap().catch((err) => {
  log('error', `Bootstrap failed: ${err}`);
  transitionState('ERROR', `Bootstrap error: ${err}`);
});

// Export empty to make this a module
export {};
