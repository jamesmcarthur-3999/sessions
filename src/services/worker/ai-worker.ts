/**
 * AI Worker - Runs Baleybots off the main thread
 *
 * This keeps FULL Baleybots functionality:
 * - Pipeline compilation and caching
 * - Retry with exponential backoff (using baleybots' withRetry)
 * - Rate limiting
 * - Multimodal input builders
 * - Output schema validation
 *
 * v2 Changes:
 * - MessageQueue for sequential processing (fixes C2 race condition)
 * - WorkerStateMachine for lifecycle tracking (fixes D4, D5)
 * - Proper error → terminate flow (fixes C3)
 * - State change events emitted to main thread
 * - Uses baleybots' withRetry instead of custom implementation
 *
 * v3 Changes:
 * - Removed Tauri HTTP proxy support - Web Workers don't have window.__TAURI__
 * - Always use native fetch with 'anthropic-dangerous-direct-browser-access' header
 *   (Anthropic supports direct browser access, no proxy needed)
 */

/// <reference lib="webworker" />

import type {
  WorkerMessage,
  WorkerResponse,
  WorkerSessionContext,
  WorkerActivityMetrics,
} from './types';
import type {
  ActivityDetection,
  RollingSummary,
  AnalysisModeDecision,
  QAResponse,
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

    // Always use direct browser API access with CORS headers
    // Web Workers have native fetch but no window.__TAURI__
    // Anthropic supports direct browser access via this header
    log('info', 'Configuring direct browser API access');
    baleybots.Baleybot.setGlobalConfig({
      anthropic: {
        headers: {
          'anthropic-dangerous-direct-browser-access': 'true',
        },
      },
    });

    // Set API keys
    if (anthropicKey) {
      baleybots.setDefaultApiKey('anthropic', anthropicKey);
      log('info', 'Anthropic API key configured');
    }
    if (openaiKey) {
      baleybots.setDefaultApiKey('openai', openaiKey);
      log('info', 'OpenAI API key configured');
    }

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
 * Used for converting binary transfer data to format needed by API
 */
function arrayBufferToBase64(buffer: ArrayBuffer, mimeType: string): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
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
// Audio Transcription
// ============================================================================

async function transcribeAudio(
  msg: Extract<WorkerMessage, { type: 'transcribe-audio' }>
): Promise<void> {
  const { sessionId, chunkId, audioBase64, id } = msg;

  if (!openaiKey) {
    send({
      type: 'error',
      id,
      sessionId,
      error: 'OpenAI API key not configured for transcription',
    });
    return;
  }

  transitionState('PROCESSING', 'Transcribing audio');

  try {
    send({ type: 'transcription-start', sessionId });

    // Prepare audio data
    const base64Data = audioBase64.replace(/^data:audio\/\w+;base64,/, '');
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: 'audio/wav' });
    const formData = new FormData();
    formData.append('file', blob, 'audio.wav');
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'json');

    // Call Whisper API
    const response = await withRetry(async () => {
      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openaiKey}`,
        },
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`Whisper API error: ${res.status}`);
      }

      return res.json();
    });

    const text = response.text || '';

    send({
      type: 'transcription-complete',
      id,
      sessionId,
      chunkId,
      text,
    });

    log('info', `Transcribed: ${text.substring(0, 50)}...`);

    // Request summary update after transcription
    if (text.trim()) {
      send({ type: 'request-summary-update', sessionId });
    }

    transitionState('INITIALIZED', 'Transcription complete');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Transcription failed: ${message}`);
    send({
      type: 'error',
      id,
      sessionId,
      error: `Audio transcription failed: ${message}`,
    });
    transitionState('INITIALIZED', 'Transcription failed');
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
    send({
      type: 'error',
      id,
      sessionId,
      error: 'OpenAI API key not configured for transcription',
    });
    return;
  }

  transitionState('PROCESSING', 'Transcribing audio (binary)');

  try {
    send({ type: 'transcription-start', sessionId });

    // Create Blob directly from ArrayBuffer (no base64 decoding needed!)
    const blob = new Blob([audioData], { type: 'audio/wav' });
    const formData = new FormData();
    formData.append('file', blob, 'audio.wav');
    formData.append('model', 'whisper-1');
    formData.append('response_format', 'json');

    // Call Whisper API
    const response = await withRetry(async () => {
      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openaiKey}`,
        },
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`Whisper API error: ${res.status}`);
      }

      return res.json();
    });

    const text = response.text || '';

    send({
      type: 'transcription-complete',
      id,
      sessionId,
      chunkId,
      text,
    });

    log('info', `Transcribed (binary): ${text.substring(0, 50)}...`);

    // Request summary update after transcription
    if (text.trim()) {
      send({ type: 'request-summary-update', sessionId });
    }

    transitionState('INITIALIZED', 'Transcription complete');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', `Transcription failed: ${message}`);
    send({
      type: 'error',
      id,
      sessionId,
      error: `Audio transcription failed: ${message}`,
    });
    transitionState('INITIALIZED', 'Transcription failed');
  }
}

// ============================================================================
// Summary Updates
// ============================================================================

async function updateSummary(
  msg: Extract<WorkerMessage, { type: 'update-summary' }>
): Promise<void> {
  const { sessionId, contextJson, id } = msg;

  if (!botsModule || !isReady()) {
    log('info', 'Skipping summary update - not ready');
    return;
  }

  transitionState('PROCESSING', 'Updating summary');

  try {
    const context: WorkerSessionContext = JSON.parse(contextJson);

    const sessionContext = {
      sessionId: context.sessionId,
      rollingSummary: context.rollingSummary,
      recentScreenshots: context.recentScreenshots.map((s) => ({
        id: s.id,
        capturedAt: s.capturedAt,
        appName: s.appName,
        windowTitle: s.windowTitle,
        analysis: s.analysis,
      })),
      recentTranscripts: context.recentTranscripts,
      recentInsights: context.recentInsights,
      durationSeconds: context.durationSeconds,
      analysisMode: context.analysisMode,
    };

    const input = botsModule.buildSummarizerInput(sessionContext);

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
  const { sessionId, contextJson, metricsJson } = msg;

  if (!botsModule || !isReady()) {
    return;
  }

  transitionState('PROCESSING', 'Checking analysis mode');

  try {
    const context: WorkerSessionContext = JSON.parse(contextJson);
    const metrics: WorkerActivityMetrics = JSON.parse(metricsJson);

    const sessionContext = {
      sessionId: context.sessionId,
      rollingSummary: context.rollingSummary,
      recentScreenshots: context.recentScreenshots.map((s) => ({
        id: s.id,
        capturedAt: s.capturedAt,
        appName: s.appName,
        windowTitle: s.windowTitle,
        analysis: s.analysis,
      })),
      recentTranscripts: context.recentTranscripts,
      recentInsights: context.recentInsights,
      durationSeconds: context.durationSeconds,
      analysisMode: context.analysisMode,
    };

    const input = botsModule.buildAnalysisControllerInput(sessionContext, metrics);

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
  const { requestId, message, contextJson, id } = msg;

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
    const context: WorkerSessionContext = JSON.parse(contextJson);

    const sessionContext = {
      sessionId: context.sessionId,
      rollingSummary: context.rollingSummary,
      recentScreenshots: context.recentScreenshots.map((s) => ({
        id: s.id,
        capturedAt: s.capturedAt,
        appName: s.appName,
        windowTitle: s.windowTitle,
        analysis: s.analysis,
      })),
      recentTranscripts: context.recentTranscripts,
      recentInsights: context.recentInsights,
      durationSeconds: context.durationSeconds,
      analysisMode: context.analysisMode,
    };

    const input = botsModule.buildQAInput(message, sessionContext);

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

    case 'transcribe-audio':
      await transcribeAudio(msg);
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
