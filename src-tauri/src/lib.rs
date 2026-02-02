mod audio_capture;
mod video_recording;

use tauri::Manager;
use screenshots::{Screen, image::ImageFormat};
use std::io::Cursor;
use std::sync::{Arc, Mutex};
use audio_capture::AudioRecorder;
use video_recording::VideoRecorder;

// ============================================================================
// Screenshot Capture
// ============================================================================

/// Helper function for retry with exponential backoff
fn capture_with_retry<F, T>(operation: F, max_retries: u32) -> Result<T, String>
where
    F: Fn() -> Result<T, String>,
{
    let mut last_error = String::new();

    for attempt in 0..max_retries {
        match operation() {
            Ok(result) => return Ok(result),
            Err(e) => {
                last_error = e.clone();
                if attempt < max_retries - 1 {
                    let delay_ms = 100 * 2_u64.pow(attempt);
                    eprintln!("Screenshot capture failed (attempt {}), retrying in {}ms: {}", attempt + 1, delay_ms, e);
                    std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                }
            }
        }
    }

    Err(format!("Screenshot capture failed after {} attempts: {}", max_retries, last_error))
}

// ============================================================================
// Device Enumeration
// ============================================================================

/// Get list of available audio input devices
#[tauri::command]
fn get_audio_devices() -> Result<Vec<serde_json::Value>, String> {
    use cpal::traits::{DeviceTrait, HostTrait};

    let host = cpal::default_host();
    let mut devices = Vec::new();

    // Get default device name for marking
    let default_device_name = host
        .default_input_device()
        .and_then(|d| d.name().ok());

    // Enumerate input devices
    let input_devices = host.input_devices()
        .map_err(|e| format!("Failed to enumerate input devices: {}", e))?;

    for (index, device) in input_devices.enumerate() {
        let name = device.name().unwrap_or_else(|_| format!("Device {}", index));
        let is_default = default_device_name.as_ref() == Some(&name);

        devices.push(serde_json::json!({
            "id": index.to_string(),
            "name": name,
            "isDefault": is_default,
        }));
    }

    Ok(devices)
}

/// Get list of available screens
#[tauri::command]
fn get_screens() -> Result<Vec<serde_json::Value>, String> {
    let screens = Screen::all().map_err(|e| format!("Failed to get screens: {}", e))?;

    let mut result = Vec::new();
    for (index, screen) in screens.iter().enumerate() {
        let info = screen.display_info;
        result.push(serde_json::json!({
            "id": index.to_string(),
            "name": format!("Display {}", index + 1),
            "width": info.width,
            "height": info.height,
            "x": info.x,
            "y": info.y,
            "isPrimary": info.is_primary,
        }));
    }

    Ok(result)
}

// ============================================================================
// Screenshot Capture
// ============================================================================

/// Captures a specific screen (or primary if not specified) and returns base64-encoded PNG data
#[tauri::command]
fn capture_screenshot(screen_id: Option<String>) -> Result<String, String> {
    capture_with_retry(|| {
        let screens = Screen::all().map_err(|e| format!("Failed to get screens: {}", e))?;

        if screens.is_empty() {
            return Err("No screens found".to_string());
        }

        // Select screen by ID (index) or default to first
        let screen_idx: usize = screen_id
            .as_ref()
            .and_then(|id| id.parse().ok())
            .unwrap_or(0);

        let screen = screens.get(screen_idx).unwrap_or(&screens[0]);
        let image = screen.capture().map_err(|e| format!("Failed to capture screen: {}", e))?;

        let mut bytes: Vec<u8> = Vec::new();
        let mut cursor = Cursor::new(&mut bytes);
        image
            .write_to(&mut cursor, ImageFormat::Png)
            .map_err(|e| format!("Failed to encode PNG: {}", e))?;

        let base64_data = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
        Ok(format!("data:image/png;base64,{}", base64_data))
    }, 3)
}

// ============================================================================
// Screen Recording Permission (macOS)
// ============================================================================

#[cfg(target_os = "macos")]
#[tauri::command]
fn request_screen_recording_permission() -> Result<bool, String> {
    extern "C" {
        fn CGRequestScreenCaptureAccess() -> u8;
        fn CGPreflightScreenCaptureAccess() -> u8;
    }

    unsafe {
        let has_permission = CGPreflightScreenCaptureAccess() != 0;
        if !has_permission {
            let granted = CGRequestScreenCaptureAccess() != 0;
            Ok(granted)
        } else {
            Ok(true)
        }
    }
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn check_screen_recording_permission() -> Result<bool, String> {
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> u8;
    }
    unsafe { Ok(CGPreflightScreenCaptureAccess() != 0) }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn request_screen_recording_permission() -> Result<bool, String> {
    Ok(true)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn check_screen_recording_permission() -> Result<bool, String> {
    Ok(true)
}

// ============================================================================
// Audio Recording Commands
// ============================================================================

#[tauri::command]
fn start_audio_recording(
    session_id: String,
    chunk_duration_secs: Option<u64>,
    device_id: Option<String>,
    recorder: tauri::State<'_, Arc<Mutex<AudioRecorder>>>,
) -> Result<(), String> {
    let recorder = recorder.lock()
        .map_err(|e| format!("Failed to lock audio recorder: {}", e))?;
    recorder.start_recording(session_id, chunk_duration_secs.unwrap_or(120), device_id)
}

#[tauri::command]
fn pause_audio_recording(
    recorder: tauri::State<'_, Arc<Mutex<AudioRecorder>>>,
) -> Result<(), String> {
    let recorder = recorder.lock()
        .map_err(|e| format!("Failed to lock audio recorder: {}", e))?;
    recorder.pause_recording()
}

#[tauri::command]
fn stop_audio_recording(
    recorder: tauri::State<'_, Arc<Mutex<AudioRecorder>>>,
) -> Result<(), String> {
    let recorder = recorder.lock()
        .map_err(|e| format!("Failed to lock audio recorder: {}", e))?;
    recorder.stop_recording()
}

// Video Recording Commands are defined in video_recording.rs module

// ============================================================================
// App Entry Point
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Create recording state
    let audio_recorder = Arc::new(Mutex::new(AudioRecorder::new()));
    let video_recorder = Arc::new(Mutex::new(VideoRecorder::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .manage(audio_recorder.clone())
        .manage(video_recorder)
        .setup(move |app| {
            // Initialize audio recorder with app handle
            if let Ok(recorder) = audio_recorder.lock() {
                if let Err(e) = recorder.init(app.handle().clone()) {
                    eprintln!("Failed to initialize audio recorder: {}", e);
                }
            }

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Device enumeration
            get_audio_devices,
            get_screens,
            // Screenshot
            capture_screenshot,
            // Permissions
            request_screen_recording_permission,
            check_screen_recording_permission,
            // Audio
            start_audio_recording,
            pause_audio_recording,
            stop_audio_recording,
            // Video (from video_recording module)
            video_recording::start_video_recording,
            video_recording::stop_video_recording,
            video_recording::is_recording,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
