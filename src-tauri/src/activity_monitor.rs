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
}

impl ActivityMonitor {
    pub fn new() -> Self {
        Self {
            stop_flag: Arc::new(AtomicBool::new(false)),
            is_started: AtomicBool::new(false),
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
        std::thread::spawn(move || {
            let mut last_app: Option<String> = None;
            let mut last_window: Option<String> = None;

            // Continue until stop flag is set
            while !stop_flag.load(Ordering::SeqCst) {
                // Poll every 500ms
                std::thread::sleep(Duration::from_millis(500));

                // Check stop flag again after sleep
                if stop_flag.load(Ordering::SeqCst) {
                    break;
                }

                // Get frontmost application (macOS)
                if let Some((app_name, window_title)) = get_frontmost_app() {
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
            }

            println!("[ACTIVITY MONITOR] Monitoring thread exiting");
        });

        Ok(())
    }

    /// Stop monitoring
    pub fn stop(&self) {
        println!("[ACTIVITY MONITOR] Stopping activity monitoring");
        // Set stop flag - the thread will see this and exit
        self.stop_flag.store(true, Ordering::SeqCst);
        // Mark as not started so it can be restarted
        self.is_started.store(false, Ordering::SeqCst);
    }

    /// Check if monitoring is active
    pub fn is_running(&self) -> bool {
        self.is_started.load(Ordering::SeqCst) && !self.stop_flag.load(Ordering::SeqCst)
    }
}

/// Get the frontmost application name and window title (macOS)
#[cfg(target_os = "macos")]
fn get_frontmost_app() -> Option<(String, String)> {
    use std::process::Command;

    // Use AppleScript to get frontmost app
    let output = Command::new("osascript")
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
        .output()
        .ok()?;

    let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parts: Vec<&str> = result.splitn(2, '|').collect();

    if !parts.is_empty() {
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
