//! Activity Monitor
//!
//! Monitors system events to trigger smart screenshots:
//! - Application switches
//! - Window focus changes
//! - Mouse activity after idle
//! - Keyboard activity bursts
//! - Clipboard changes

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Normal polling interval for frontmost app detection
const POLL_INTERVAL_MS: u64 = 3000;

/// Faster polling interval after an app switch (captures rapid context changes)
const FAST_POLL_INTERVAL_MS: u64 = 1500;

/// How long to use fast polling after an app switch
const FAST_POLL_DURATION_SECS: u64 = 10;

/// Events emitted to the frontend
#[derive(Clone, serde::Serialize)]
pub struct ActivityEvent {
    pub event_type: String,
    pub app_name: Option<String>,
    pub window_title: Option<String>,
    pub timestamp: u64,
}

/// Activity monitor state
pub struct ActivityMonitor {
    /// Shared flag to signal the monitoring thread to stop
    stop_flag: Arc<AtomicBool>,
    /// Whether monitoring has been started
    is_started: AtomicBool,
    /// Thread handle for cleanup
    thread_handle: std::sync::Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl ActivityMonitor {
    pub fn new() -> Self {
        Self {
            stop_flag: Arc::new(AtomicBool::new(false)),
            is_started: AtomicBool::new(false),
            thread_handle: std::sync::Mutex::new(None),
        }
    }

    /// Start monitoring for activity
    pub fn start(&self, app_handle: AppHandle) -> Result<(), String> {
        // Check if already started
        if self.is_started.swap(true, Ordering::SeqCst) {
            println!("[ACTIVITY MONITOR] Already running");
            return Ok(());
        }

        // Reset stop flag
        self.stop_flag.store(false, Ordering::SeqCst);

        println!("[ACTIVITY MONITOR] Starting activity monitoring");

        // Clone the stop flag for the thread
        let stop_flag = self.stop_flag.clone();

        // Spawn monitoring thread
        let handle = std::thread::spawn(move || {
            let mut last_app: Option<String> = None;
            let mut last_window: Option<String> = None;
            // Adaptive polling: normal rate, faster after app switch
            let mut poll_interval_ms: u64 = POLL_INTERVAL_MS;
            let mut fast_poll_until: Option<std::time::Instant> = None;
            // Circuit breaker: stop after too many consecutive failures
            let mut consecutive_failures: u32 = 0;
            const MAX_CONSECUTIVE_FAILURES: u32 = 10;

            // Continue until stop flag is set
            while !stop_flag.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(poll_interval_ms));

                // Check stop flag again after sleep
                if stop_flag.load(Ordering::SeqCst) {
                    break;
                }

                // Return to normal polling after fast-poll window expires
                if let Some(until) = fast_poll_until {
                    if std::time::Instant::now() > until {
                        poll_interval_ms = POLL_INTERVAL_MS;
                        fast_poll_until = None;
                    }
                }

                // Get frontmost application (macOS)
                let frontmost = match get_frontmost_app() {
                    Some(result) => {
                        consecutive_failures = 0;
                        result
                    }
                    None => {
                        consecutive_failures += 1;
                        if consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
                            eprintln!("[ACTIVITY MONITOR] Disabling after {} consecutive failures", MAX_CONSECUTIVE_FAILURES);
                            break;
                        }
                        continue;
                    }
                };
                let (app_name, window_title) = frontmost;

                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;

                // Check for app switch
                let app_switched = last_app.as_ref() != Some(&app_name);
                let window_changed = last_window.as_ref() != Some(&window_title);

                if app_switched {
                    println!("[ACTIVITY MONITOR] App switch: {:?} -> {}", last_app, app_name);

                    let event = ActivityEvent {
                        event_type: "app_switch".to_string(),
                        app_name: Some(app_name.clone()),
                        window_title: Some(window_title.clone()),
                        timestamp: now,
                    };

                    if let Err(e) = app_handle.emit("activity-event", event) {
                        eprintln!("[ACTIVITY MONITOR] Failed to emit event: {}", e);
                    }

                    // Enter fast-polling mode after an app switch
                    poll_interval_ms = FAST_POLL_INTERVAL_MS;
                    fast_poll_until = Some(std::time::Instant::now() + Duration::from_secs(FAST_POLL_DURATION_SECS));

                    last_app = Some(app_name.clone());
                }

                if window_changed && !app_switched {
                    // Only emit window change if app didn't switch (to avoid duplicate events)
                    let event = ActivityEvent {
                        event_type: "window_change".to_string(),
                        app_name: Some(app_name.clone()),
                        window_title: Some(window_title.clone()),
                        timestamp: now,
                    };

                    if let Err(e) = app_handle.emit("activity-event", event) {
                        eprintln!("[ACTIVITY MONITOR] Failed to emit event: {}", e);
                    }
                }

                last_window = Some(window_title);
                if last_app.is_none() {
                    last_app = Some(app_name);
                }
            }

            println!("[ACTIVITY MONITOR] Monitoring thread exiting");
        });

        if let Ok(mut h) = self.thread_handle.lock() {
            *h = Some(handle);
        }

        Ok(())
    }

    /// Stop monitoring
    pub fn stop(&self) {
        println!("[ACTIVITY MONITOR] Stopping activity monitoring");
        // Set stop flag - the thread will see this and exit
        self.stop_flag.store(true, Ordering::SeqCst);
        // Mark as not started so it can be restarted
        self.is_started.store(false, Ordering::SeqCst);

        // Join the monitoring thread
        if let Ok(mut handle) = self.thread_handle.lock() {
            if let Some(h) = handle.take() {
                let _ = h.join();
            }
        }
    }

}

/// Get the frontmost application name and window title (macOS)
#[cfg(target_os = "macos")]
fn get_frontmost_app() -> Option<(String, String)> {
    use std::process::{Command, Stdio};
    use std::io::Read;
    use wait_timeout::ChildExt;

    let mut child = match Command::new("osascript")
        .arg("-e")
        .arg(r#"
            tell application "System Events"
                set frontApp to first application process whose frontmost is true
                set appName to name of frontApp
                try
                    set winTitle to name of front window of frontApp
                on error
                    set winTitle to ""
                end try
                return appName & "|" & winTitle
            end tell
        "#)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(e) => {
            eprintln!("[ACTIVITY MONITOR] Failed to spawn osascript: {}", e);
            return None;
        }
    };

    // Wait with 3-second timeout
    match child.wait_timeout(Duration::from_secs(3)) {
        Ok(Some(status)) => {
            if !status.success() {
                return None;
            }
        }
        Ok(None) => {
            // Timeout - kill the process
            let _ = child.kill();
            let _ = child.wait();
            eprintln!("[ACTIVITY MONITOR] osascript timed out after 3s");
            return None;
        }
        Err(e) => {
            eprintln!("[ACTIVITY MONITOR] Failed to wait for osascript: {}", e);
            return None;
        }
    }

    // Read stdout
    let mut output = String::new();
    if let Some(mut stdout) = child.stdout.take() {
        stdout.read_to_string(&mut output).ok();
    }

    let result = output.trim().to_string();
    let parts: Vec<&str> = result.splitn(2, '|').collect();

    if !parts.is_empty() && !parts[0].is_empty() {
        Some((
            parts[0].to_string(),
            parts.get(1).unwrap_or(&"").to_string(),
        ))
    } else {
        None
    }
}

#[cfg(not(target_os = "macos"))]
fn get_frontmost_app() -> Option<(String, String)> {
    None // Not implemented for other platforms yet
}

impl Default for ActivityMonitor {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for ActivityMonitor {
    fn drop(&mut self) {
        self.stop();
    }
}
