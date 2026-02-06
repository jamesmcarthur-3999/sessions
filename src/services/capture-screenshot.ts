/**
 * Shared screenshot capture-and-analyze logic.
 *
 * Used by both interval-based capture (recording.ts) and
 * smart capture (smart-capture.ts).
 */

import { captureScreenshotToFile } from './recording';
import { saveScreenshot } from './database';
import { loadScreenshotBinary } from './screenshot-storage';
import { aiWorker } from './worker';
import { generateId } from '../utils/id';
import { logger } from '../utils/logger';

export interface CaptureResult {
  screenshotId: string;
  filePath: string;
  dbId: string;
}

/**
 * Capture a screenshot, save metadata to DB, and send for AI analysis.
 * Returns the capture result, or throws on capture/DB failure.
 * Analysis failures are logged but don't throw.
 */
export async function captureAnalyzeScreenshot(
  sessionId: string,
  screenId: string | null,
  trigger: string,
  appName?: string,
  windowTitle?: string,
  maxWidth = 1280,
  quality = 75,
): Promise<CaptureResult> {
  // 1. Capture screenshot directly to file
  const screenshotId = generateId();
  const filePath = await captureScreenshotToFile(
    sessionId,
    screenshotId,
    screenId,
    maxWidth,
    quality,
  );

  // 2. Save metadata to database
  const dbScreenshot = await saveScreenshot(
    sessionId,
    screenshotId,
    filePath,
    trigger as 'manual' | 'interval' | 'app_switch' | 'session_start' | 'session_end',
    appName,
    windowTitle,
  );

  // 3. Load binary and send for AI analysis (non-blocking)
  try {
    const imageData = await loadScreenshotBinary(filePath);
    aiWorker.analyzeScreenshotBinary(
      sessionId,
      dbScreenshot.id,
      imageData,
      trigger,
      null,
    ).catch(logger.error);
  } catch (loadError) {
    logger.error('Failed to load screenshot binary for analysis:', loadError);
  }

  return {
    screenshotId,
    filePath,
    dbId: dbScreenshot.id,
  };
}
