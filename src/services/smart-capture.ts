/**
 * Smart Capture Service
 *
 * Manages event-driven screenshot capture based on:
 * - Application switches
 * - Window focus changes
 * - Activity after idle periods
 * - Keyboard bursts
 * - Maximum interval fallback (1 minute)
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { saveScreenshot } from './database';
import { sessionCoordinator } from './session-coordinator';
import { captureScreenshot, isTauri } from './recording';
import type { DbScreenshot } from '../types/database';

interface ActivityEvent {
  event_type: string;
  app_name: string | null;
  window_title: string | null;
  timestamp: number;
}

interface SmartCaptureConfig {
  enabled: boolean;
  maxIntervalMs: number;      // Maximum time between captures (fallback)
  minIntervalMs: number;      // Minimum time between captures (debounce)
  idleThresholdMs: number;    // Time to consider user idle
}

const defaultConfig: SmartCaptureConfig = {
  enabled: true,
  maxIntervalMs: 60000,       // 1 minute max
  minIntervalMs: 3000,        // 3 second debounce
  idleThresholdMs: 5000,      // 5 seconds idle
};

class SmartCaptureService {
  private config: SmartCaptureConfig = defaultConfig;
  private sessionId: string | null = null;
  private screenId: string | null = null;
  private isRunning = false;

  // State tracking
  private lastApp: string | null = null;
  private lastWindow: string | null = null;
  private lastCaptureTime = 0;

  // Listeners and timers
  private unlisten: UnlistenFn | null = null;
  private fallbackInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Start smart capture for a session
   */
  async start(
    sessionId: string,
    screenId: string | null,
    config: Partial<SmartCaptureConfig> = {}
  ): Promise<void> {
    if (this.isRunning) {
      console.warn('[SMART CAPTURE] Already running');
      return;
    }

    this.sessionId = sessionId;
    this.screenId = screenId;
    this.config = { ...defaultConfig, ...config };
    this.isRunning = true;
    this.lastCaptureTime = Date.now();

    console.log('[SMART CAPTURE] Starting for session:', sessionId, this.config);

    if (!isTauri()) {
      console.log('[SMART CAPTURE] Browser mode, using interval only');
      this.startFallbackInterval();
      return;
    }

    // Listen for activity events from Rust
    this.unlisten = await listen<ActivityEvent>('activity-event', (event) => {
      this.handleActivityEvent(event.payload);
    });

    // Start activity monitor in Rust
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('start_activity_monitor');
      console.log('[SMART CAPTURE] Activity monitor started');
    } catch (e) {
      console.error('[SMART CAPTURE] Failed to start activity monitor:', e);
    }

    // Start fallback interval
    this.startFallbackInterval();

    // Capture initial screenshot
    await this.captureNow('session_start');

    console.log('[SMART CAPTURE] Started for session:', sessionId);
  }

  /**
   * Stop smart capture
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('[SMART CAPTURE] Stopping');

    // Capture final screenshot before stopping
    if (this.sessionId) {
      await this.captureNow('session_end');
    }

    this.isRunning = false;

    if (this.unlisten) {
      this.unlisten();
      this.unlisten = null;
    }

    if (this.fallbackInterval) {
      clearInterval(this.fallbackInterval);
      this.fallbackInterval = null;
    }

    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('stop_activity_monitor');
      } catch (e) {
        console.error('[SMART CAPTURE] Failed to stop activity monitor:', e);
      }
    }

    this.sessionId = null;
    console.log('[SMART CAPTURE] Stopped');
  }

  /**
   * Handle activity event from Rust
   */
  private async handleActivityEvent(event: ActivityEvent): Promise<void> {
    if (!this.isRunning || !this.sessionId) return;

    // Check for app switch
    if (event.event_type === 'app_switch' && event.app_name) {
      console.log('[SMART CAPTURE] App switch detected:', this.lastApp, '->', event.app_name);
      this.lastApp = event.app_name;
      this.lastWindow = event.window_title;

      // Track app switch for adaptive analysis
      sessionCoordinator.trackAppSwitch(this.sessionId, event.app_name);

      await this.captureIfAllowed('app_switch');
    }

    // Check for window change (don't capture, just track)
    if (event.event_type === 'window_change' && event.window_title) {
      this.lastWindow = event.window_title;
    }
  }

  /**
   * Capture screenshot if minimum interval has passed
   */
  private async captureIfAllowed(
    trigger: DbScreenshot['trigger']
  ): Promise<void> {
    const now = Date.now();
    const timeSinceLastCapture = now - this.lastCaptureTime;

    if (timeSinceLastCapture < this.config.minIntervalMs) {
      console.log('[SMART CAPTURE] Capture skipped (debounce):', timeSinceLastCapture, 'ms');
      return;
    }

    await this.captureNow(trigger);
  }

  /**
   * Capture screenshot immediately
   */
  private async captureNow(
    trigger: DbScreenshot['trigger']
  ): Promise<void> {
    if (!this.sessionId) return;

    // Skip actual capture in browser mode
    if (!isTauri()) {
      console.log('[SMART CAPTURE] Browser mode, skipping actual capture');
      this.lastCaptureTime = Date.now();
      return;
    }

    try {
      const screenshot = await captureScreenshot(this.screenId);
      this.lastCaptureTime = Date.now();

      // Save to database
      const dbScreenshot = await saveScreenshot(
        this.sessionId,
        screenshot,
        trigger,
        this.lastApp ?? undefined,
        this.lastWindow ?? undefined
      );

      // Notify coordinator for AI analysis
      sessionCoordinator.processScreenshot(this.sessionId, dbScreenshot).catch(console.error);

      console.log(`[SMART CAPTURE] Captured: ${trigger}`, {
        app: this.lastApp,
        window: this.lastWindow,
      });
    } catch (e) {
      console.error('[SMART CAPTURE] Capture failed:', e);
    }
  }

  /**
   * Start fallback interval (max time between captures)
   */
  private startFallbackInterval(): void {
    this.fallbackInterval = setInterval(async () => {
      if (!this.isRunning || !this.sessionId) return;

      const now = Date.now();
      const timeSinceLastCapture = now - this.lastCaptureTime;

      // Capture if max interval exceeded
      if (timeSinceLastCapture >= this.config.maxIntervalMs) {
        await this.captureNow('interval');
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Manually trigger a capture
   */
  async manualCapture(): Promise<void> {
    if (this.sessionId) {
      await this.captureNow('manual');
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SmartCaptureConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current state
   */
  getState() {
    return {
      isRunning: this.isRunning,
      sessionId: this.sessionId,
      lastApp: this.lastApp,
      lastWindow: this.lastWindow,
      lastCaptureTime: this.lastCaptureTime,
    };
  }
}

export const smartCapture = new SmartCaptureService();
