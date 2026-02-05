/**
 * Smart Capture Service
 *
 * Simple, predictable screenshot timing based on activity:
 * - MINIMUM interval: 10 seconds (hard floor)
 * - MAXIMUM interval: 60 seconds (ceiling)
 * - Activity level (0-1) reduces the interval linearly
 * - App switches trigger immediate capture (respecting minimum)
 *
 * Formula: nextCapture = MAX - (activityLevel × (MAX - MIN))
 * - No activity: 60 seconds
 * - Max activity: 10 seconds
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { saveScreenshot } from './database';
import { aiWorker } from './worker';
import { captureScreenshotOptimized, isTauri } from './recording';
import { loadScreenshotBinary } from './screenshot-storage';
import { EventEmitter } from './event-emitter';

// ============================================================================
// Constants
// ============================================================================

const MIN_INTERVAL_MS = 10_000;  // 10 seconds - hard floor
const MAX_INTERVAL_MS = 60_000;  // 60 seconds - ceiling
const ACTIVITY_DECAY_MS = 30_000; // Activity decays over 30 seconds
const TICK_INTERVAL_MS = 1000;   // Check every 1 second

// ============================================================================
// Types
// ============================================================================

type SmartCaptureEvents = {
  'capture': { sessionId: string; trigger: string };
  'state-change': SmartCaptureState;
};

interface ActivityEvent {
  event_type: string;
  app_name: string | null;
  window_title: string | null;
  timestamp: number;
}

export interface SmartCaptureState {
  isRunning: boolean;
  activityLevel: number;        // 0-1, higher = more active
  timeToNextCaptureMs: number;  // Countdown to next capture
  lastCaptureTime: number;      // Timestamp of last capture
  lastApp: string | null;
  captureCount: number;
}

// ============================================================================
// Smart Capture Service
// ============================================================================

class SmartCaptureService {
  private emitter = new EventEmitter<SmartCaptureEvents>();

  // Session state
  private sessionId: string | null = null;
  private screenId: string | null = null;
  private isRunning = false;

  // Timing state
  private lastCaptureTime = 0;
  private activityLevel = 0;
  private lastActivityTime = 0;
  private captureCount = 0;

  // Context tracking
  private lastApp: string | null = null;
  private lastWindow: string | null = null;

  // Listeners and timers
  private unlisten: UnlistenFn | null = null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  // Pending capture flag (prevents stacking)
  private capturePending = false;

  /**
   * Subscribe to events
   */
  on<K extends keyof SmartCaptureEvents>(
    event: K,
    callback: (data: SmartCaptureEvents[K]) => void
  ): () => void {
    return this.emitter.on(event, callback);
  }

  /**
   * Start smart capture for a session
   */
  async start(sessionId: string, screenId: string | null): Promise<void> {
    if (this.isRunning) {
      console.warn('[SMART CAPTURE] Already running');
      return;
    }

    this.sessionId = sessionId;
    this.screenId = screenId;
    this.isRunning = true;
    this.lastCaptureTime = Date.now();
    this.activityLevel = 0.5; // Start at medium activity
    this.lastActivityTime = Date.now();
    this.captureCount = 0;
    this.capturePending = false;

    console.log('[SMART CAPTURE] Starting', { sessionId, screenId });

    if (!isTauri()) {
      console.log('[SMART CAPTURE] Browser mode - limited functionality');
      this.startTick();
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

    // Start tick loop
    this.startTick();

    // Capture initial screenshot
    await this.captureNow('session_start');

    this.emitStateChange();
  }

  /**
   * Stop smart capture
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log('[SMART CAPTURE] Stopping');
    this.isRunning = false;

    // Final capture
    if (this.sessionId) {
      await this.captureNow('session_end');
    }

    // Cleanup
    if (this.unlisten) {
      this.unlisten();
      this.unlisten = null;
    }

    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
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
   * Get current state (for UI)
   */
  getState(): SmartCaptureState {
    return {
      isRunning: this.isRunning,
      activityLevel: this.activityLevel,
      timeToNextCaptureMs: this.calculateTimeToNextCapture(),
      lastCaptureTime: this.lastCaptureTime,
      lastApp: this.lastApp,
      captureCount: this.captureCount,
    };
  }

  /**
   * Manual capture trigger
   */
  async manualCapture(): Promise<void> {
    if (this.sessionId && this.canCapture()) {
      await this.captureNow('manual');
    }
  }

  // ============================================================================
  // Private: Timing Logic
  // ============================================================================

  /**
   * Calculate current interval based on activity level
   * High activity = shorter interval (closer to MIN)
   * Low activity = longer interval (closer to MAX)
   */
  private calculateInterval(): number {
    const range = MAX_INTERVAL_MS - MIN_INTERVAL_MS;
    return MAX_INTERVAL_MS - (this.activityLevel * range);
  }

  /**
   * Calculate time remaining until next capture
   */
  private calculateTimeToNextCapture(): number {
    const elapsed = Date.now() - this.lastCaptureTime;
    const interval = this.calculateInterval();
    return Math.max(0, interval - elapsed);
  }

  /**
   * Check if we can capture (minimum interval passed)
   */
  private canCapture(): boolean {
    const elapsed = Date.now() - this.lastCaptureTime;
    return elapsed >= MIN_INTERVAL_MS && !this.capturePending;
  }

  /**
   * Decay activity level over time
   */
  private decayActivity(): void {
    const timeSinceActivity = Date.now() - this.lastActivityTime;
    const decayFactor = Math.min(1, timeSinceActivity / ACTIVITY_DECAY_MS);

    // Decay towards 0.2 (baseline idle activity)
    const baseline = 0.2;
    this.activityLevel = baseline + (this.activityLevel - baseline) * (1 - decayFactor * 0.1);
    this.activityLevel = Math.max(0, Math.min(1, this.activityLevel));
  }

  /**
   * Bump activity level (called on activity events)
   */
  private bumpActivity(amount: number): void {
    this.activityLevel = Math.min(1, this.activityLevel + amount);
    this.lastActivityTime = Date.now();
  }

  // ============================================================================
  // Private: Event Handling
  // ============================================================================

  /**
   * Handle activity event from Rust
   */
  private async handleActivityEvent(event: ActivityEvent): Promise<void> {
    if (!this.isRunning || !this.sessionId) return;

    if (event.event_type === 'app_switch' && event.app_name) {
      console.log('[SMART CAPTURE] App switch:', this.lastApp, '->', event.app_name);

      // App switch = high activity bump
      this.bumpActivity(0.4);
      this.lastApp = event.app_name;
      this.lastWindow = event.window_title;

      // Immediate capture if minimum interval passed
      if (this.canCapture()) {
        await this.captureNow('app_switch');
      }
    }

    if (event.event_type === 'window_change' && event.window_title) {
      // Window change = moderate activity bump
      this.bumpActivity(0.2);
      this.lastWindow = event.window_title;
    }

    this.emitStateChange();
  }

  /**
   * Tick loop - checks if it's time to capture
   */
  private startTick(): void {
    this.tickInterval = setInterval(async () => {
      if (!this.isRunning || !this.sessionId) return;

      // Decay activity
      this.decayActivity();

      // Check if interval has elapsed
      const timeToNext = this.calculateTimeToNextCapture();
      if (timeToNext <= 0 && this.canCapture()) {
        await this.captureNow('interval');
      }

      this.emitStateChange();
    }, TICK_INTERVAL_MS);
  }

  // ============================================================================
  // Private: Capture
  // ============================================================================

  /**
   * Capture screenshot immediately
   */
  private async captureNow(trigger: string): Promise<void> {
    if (!this.sessionId || this.capturePending) return;

    // Skip in browser mode
    if (!isTauri()) {
      console.log('[SMART CAPTURE] Browser mode, skipping capture');
      this.lastCaptureTime = Date.now();
      return;
    }

    // Set pending flag to prevent stacking
    this.capturePending = true;

    try {
      // Capture screenshot
      const screenshot = await captureScreenshotOptimized(this.screenId, 1920, 80);
      this.lastCaptureTime = Date.now();
      this.captureCount++;

      // Emit capture event for UI
      this.emitter.emit('capture', { sessionId: this.sessionId, trigger });

      // Save to database
      const dbScreenshot = await saveScreenshot(
        this.sessionId,
        screenshot,
        trigger as 'manual' | 'interval' | 'app_switch' | 'session_start' | 'session_end',
        this.lastApp ?? undefined,
        this.lastWindow ?? undefined
      );

      // Load binary from file for zero-copy transfer to worker
      try {
        const imageData = await loadScreenshotBinary(dbScreenshot.file_path);
        // Send to AI Worker for analysis using binary transfer (non-blocking)
        aiWorker.analyzeScreenshotBinary(
          this.sessionId,
          dbScreenshot.id,
          imageData,
          trigger,
          null
        ).catch(console.error);
      } catch (loadError) {
        console.error('[SMART CAPTURE] Failed to load screenshot binary for analysis:', loadError);
      }

      console.log(`[SMART CAPTURE] Captured: ${trigger}`, {
        app: this.lastApp,
        activityLevel: this.activityLevel.toFixed(2),
        count: this.captureCount,
      });
    } catch (e) {
      console.error('[SMART CAPTURE] Capture failed:', e);
    } finally {
      this.capturePending = false;
    }

    this.emitStateChange();
  }

  // ============================================================================
  // Private: State Events
  // ============================================================================

  private emitStateChange(): void {
    this.emitter.emit('state-change', this.getState());
  }
}

export const smartCapture = new SmartCaptureService();
