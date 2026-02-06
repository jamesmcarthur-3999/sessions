mod activity_monitor;
mod audio_capture;
mod http_proxy;
mod video_recording;

use activity_monitor::ActivityMonitor;
use screenshots::{Screen, image::ImageFormat};
use std::io::Cursor;
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::Manager;
use audio_capture::AudioRecorder;
use video_recording::VideoRecorder;

/// Default maximum width for screenshot resizing (preserves detail while saving bandwidth)
const DEFAULT_MAX_WIDTH: u32 = 1280;

/// Width for test capture thumbnails
const THUMBNAIL_WIDTH: u32 = 400;

/// Default JPEG quality for file-based screenshots (0-100)
const DEFAULT_JPEG_QUALITY: u8 = 75;

/// Lock a mutex, recovering from poison by accepting the potentially-stale data.
/// This is safe because our mutexes guard simple state values (not invariants).
pub(crate) fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            eprintln!("⚠️ Recovered from poisoned mutex");
            poisoned.into_inner()
        }
    }
}

/// Validate that a string is safe for use as a path component (no traversal).
fn validate_path_component(name: &str, label: &str) -> Result<(), String> {
    if name.is_empty()
        || name.contains("..")
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
    {
        return Err(format!("Invalid {}: contains unsafe characters", label));
    }
    Ok(())
}

// ============================================================================
// Screenshot Capture
// ============================================================================

/// Helper function for retry with exponential backoff (async, non-blocking)
async fn capture_with_retry<F, Fut, T>(operation: F, max_retries: u32) -> Result<T, String>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let mut last_error = String::new();

    for attempt in 0..max_retries {
        match operation().await {
            Ok(result) => return Ok(result),
            Err(e) => {
                last_error = e.clone();
                if attempt < max_retries - 1 {
                    let delay_ms = (100 * 2_u64.pow(attempt)).min(5000);
                    eprintln!("Screenshot capture failed (attempt {}), retrying in {}ms: {}", attempt + 1, delay_ms, e);
                    tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
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
/// Uses device name as stable ID (index-based IDs change between enumerations)
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

        // Use device name as stable ID (survives device enumeration changes)
        devices.push(serde_json::json!({
            "id": name.clone(),
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

/// Capture the raw screen image for the given screen ID (or primary if None).
/// Returns an RgbaImage — callers apply their own resize/encoding.
fn capture_screen_image(screen_id: Option<&str>) -> Result<screenshots::image::RgbaImage, String> {
    let screens = Screen::all().map_err(|e| format!("Failed to get screens: {}", e))?;

    if screens.is_empty() {
        return Err("No screens found".to_string());
    }

    let screen_idx: usize = screen_id
        .and_then(|id| id.parse().ok())
        .unwrap_or(0);

    let screen = screens.get(screen_idx).unwrap_or(&screens[0]);
    screen.capture().map_err(|e| format!("Failed to capture screen: {}", e))
}

/// Resize an image if wider than `max_width`, preserving aspect ratio.
fn resize_if_needed(
    image: &screenshots::image::RgbaImage,
    max_width: u32,
) -> screenshots::image::RgbaImage {
    if image.width() > max_width {
        let scale = max_width as f32 / image.width() as f32;
        let new_height = (image.height() as f32 * scale) as u32;
        screenshots::image::imageops::resize(
            image,
            max_width,
            new_height,
            screenshots::image::imageops::FilterType::Triangle,
        )
    } else {
        image.clone()
    }
}

/// Captures a specific screen (or primary if not specified) and returns base64-encoded PNG data
#[tauri::command]
async fn capture_screenshot(screen_id: Option<String>) -> Result<String, String> {
    capture_with_retry(|| {
        let sid = screen_id.clone();
        async move {
            tokio::task::spawn_blocking(move || {
                let image = capture_screen_image(sid.as_deref())?;
                let dynamic = screenshots::image::DynamicImage::ImageRgba8(image);

                let mut bytes: Vec<u8> = Vec::new();
                let mut cursor = Cursor::new(&mut bytes);
                dynamic
                    .write_to(&mut cursor, ImageFormat::Png)
                    .map_err(|e| format!("Failed to encode PNG: {}", e))?;

                let base64_data = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
                Ok(format!("data:image/png;base64,{}", base64_data))
            }).await.map_err(|e| format!("Task panicked: {}", e))?
        }
    }, 3).await
}

/// Captures an optimized screenshot and writes it directly to disk as JPEG.
/// Returns the file path instead of base64 data, eliminating the base64 IPC round-trip.
#[tauri::command]
async fn capture_screenshot_to_file(
    app_handle: tauri::AppHandle,
    session_id: String,
    screenshot_id: String,
    screen_id: Option<String>,
    max_width: Option<u32>,
    quality: Option<u8>,
) -> Result<String, String> {
    capture_with_retry(|| {
        let handle = app_handle.clone();
        let sid = screen_id.clone();
        let sess_id = session_id.clone();
        let ss_id = screenshot_id.clone();
        let mw = max_width;
        let q = quality;
        async move {
            tokio::task::spawn_blocking(move || {
                // Validate path components to prevent directory traversal
                validate_path_component(&sess_id, "session ID")?;
                validate_path_component(&ss_id, "screenshot ID")?;

                // Get app data directory and create screenshots/{session_id}/
                let data_dir = handle.path().app_data_dir()
                    .map_err(|e| format!("Failed to get app data dir: {}", e))?;
                let session_dir = data_dir.join("screenshots").join(&sess_id);
                std::fs::create_dir_all(&session_dir)
                    .map_err(|e| format!("Failed to create screenshot dir: {}", e))?;

                let image = capture_screen_image(sid.as_deref())?;
                let final_image = resize_if_needed(&image, mw.unwrap_or(DEFAULT_MAX_WIDTH));

                // Encode as JPEG directly to bytes
                let jpeg_quality = q.unwrap_or(DEFAULT_JPEG_QUALITY);
                let mut bytes: Vec<u8> = Vec::new();
                let mut cursor = Cursor::new(&mut bytes);
                let encoder = screenshots::image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, jpeg_quality);
                screenshots::image::DynamicImage::ImageRgba8(final_image)
                    .write_with_encoder(encoder)
                    .map_err(|e| format!("Failed to encode JPEG: {}", e))?;

                // Write directly to file (no base64 involved)
                let file_path = session_dir.join(format!("{}.jpg", ss_id));
                std::fs::write(&file_path, &bytes)
                    .map_err(|e| format!("Failed to write screenshot file: {}", e))?;

                let path_str = file_path.to_str()
                    .ok_or_else(|| "Screenshot path contains non-UTF-8 characters".to_string())?;
                Ok(path_str.to_string())
            }).await.map_err(|e| format!("Task panicked: {}", e))?
        }
    }, 3).await
}

/// Captures a test screenshot and returns a smaller thumbnail for preview
#[tauri::command]
async fn test_capture_screenshot(screen_id: Option<String>) -> Result<String, String> {
    capture_with_retry(|| {
        let sid = screen_id.clone();
        async move {
            tokio::task::spawn_blocking(move || {
                let image = capture_screen_image(sid.as_deref())?;
                let thumbnail = resize_if_needed(&image, THUMBNAIL_WIDTH);
                let dynamic = screenshots::image::DynamicImage::ImageRgba8(thumbnail);

                let mut bytes: Vec<u8> = Vec::new();
                let mut cursor = Cursor::new(&mut bytes);
                dynamic
                    .write_to(&mut cursor, ImageFormat::Png)
                    .map_err(|e| format!("Failed to encode PNG: {}", e))?;

                let base64_data = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
                Ok(format!("data:image/png;base64,{}", base64_data))
            }).await.map_err(|e| format!("Task panicked: {}", e))?
        }
    }, 3).await
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

    // SAFETY: CGPreflightScreenCaptureAccess and CGRequestScreenCaptureAccess are
    // stateless CoreGraphics functions with no preconditions. They query/request
    // the macOS screen recording permission and return a boolean (0 or 1).
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
    // SAFETY: Stateless CoreGraphics query function with no preconditions.
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
    app_handle: tauri::AppHandle,
    session_id: String,
    chunk_duration_secs: Option<u64>,
    device_id: Option<String>,
    recorder: tauri::State<'_, Arc<Mutex<AudioRecorder>>>,
) -> Result<(), String> {
    let recorder = lock_or_recover(&recorder);
    // Default to 10-second chunks for faster transcription feedback
    recorder.start_recording(session_id, chunk_duration_secs.unwrap_or(10), device_id, &app_handle)
}

#[tauri::command]
fn pause_audio_recording(
    recorder: tauri::State<'_, Arc<Mutex<AudioRecorder>>>,
) -> Result<(), String> {
    let recorder = lock_or_recover(&recorder);
    recorder.pause_recording()
}

#[tauri::command]
fn resume_audio_recording(
    recorder: tauri::State<'_, Arc<Mutex<AudioRecorder>>>,
) -> Result<(), String> {
    let recorder = lock_or_recover(&recorder);
    recorder.resume_recording()
}

#[tauri::command]
fn stop_audio_recording(
    recorder: tauri::State<'_, Arc<Mutex<AudioRecorder>>>,
) -> Result<(), String> {
    let recorder = lock_or_recover(&recorder);
    recorder.stop_recording()
}

// Video Recording Commands are defined in video_recording.rs module

// ============================================================================
// Activity Monitoring Commands
// ============================================================================

#[tauri::command]
fn start_activity_monitor(
    app_handle: tauri::AppHandle,
    monitor: tauri::State<'_, Arc<Mutex<ActivityMonitor>>>,
) -> Result<(), String> {
    let monitor = lock_or_recover(&monitor);
    monitor.start(app_handle)
}

#[tauri::command]
fn stop_activity_monitor(
    monitor: tauri::State<'_, Arc<Mutex<ActivityMonitor>>>,
) -> Result<(), String> {
    let monitor = lock_or_recover(&monitor);
    monitor.stop();
    Ok(())
}

// ============================================================================
// App Entry Point
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Create recording state
    let audio_recorder = Arc::new(Mutex::new(AudioRecorder::new()));
    let video_recorder = Arc::new(Mutex::new(VideoRecorder::new()));
    let activity_monitor = Arc::new(Mutex::new(ActivityMonitor::new()));

    if let Err(e) = tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(audio_recorder.clone())
        .manage(video_recorder)
        .manage(activity_monitor)
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
            capture_screenshot_to_file,
            test_capture_screenshot,
            // Permissions
            request_screen_recording_permission,
            check_screen_recording_permission,
            // Audio
            start_audio_recording,
            pause_audio_recording,
            resume_audio_recording,
            stop_audio_recording,
            // Video (from video_recording module)
            video_recording::start_video_recording,
            video_recording::stop_video_recording,
            video_recording::is_recording,
            video_recording::get_current_recording_session,
            video_recording::get_video_duration,
            video_recording::generate_video_thumbnail,
            // Activity monitoring
            start_activity_monitor,
            stop_activity_monitor,
            // HTTP proxy for AI API calls (bypasses browser CORS)
            http_proxy::http_proxy,
            http_proxy::http_proxy_stream,
        ])
        .run(tauri::generate_context!())
    {
        eprintln!("Fatal: Failed to start application: {}", e);
        #[cfg(target_os = "macos")]
        {
            use std::process::Command;
            let _ = Command::new("osascript")
                .arg("-e")
                .arg(format!(
                    r#"display dialog "Sessions failed to start:\n\n{}" with title "Sessions" buttons {{"OK"}} default button "OK" with icon stop"#,
                    e.to_string().replace('"', "'")
                ))
                .output();
        }
        std::process::exit(1);
    }
}
