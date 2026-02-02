/**
 * Video Recording Module
 *
 * Captures screen recordings during sessions using ScreenCaptureKit (via Swift FFI).
 *
 * **Implementation Status**: Functional via Swift ScreenRecorder module
 * **Platform**: macOS 12.3+ only
 */

use std::ffi::CString;
use std::os::raw::c_char;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::State;

// FFI declarations for Swift functions
#[cfg(target_os = "macos")]
extern "C" {
    fn screen_recorder_create() -> *mut std::ffi::c_void;
    fn screen_recorder_start(
        recorder: *mut std::ffi::c_void,
        path: *const c_char,
        width: i32,
        height: i32,
        fps: i32,
    ) -> bool;
    fn screen_recorder_stop(recorder: *mut std::ffi::c_void) -> bool;
    fn screen_recorder_is_recording(recorder: *mut std::ffi::c_void) -> bool;
    fn screen_recorder_destroy(recorder: *mut std::ffi::c_void);
    fn screen_recorder_check_permission() -> bool;
    fn screen_recorder_request_permission();
    fn screen_recorder_get_duration(path: *const c_char) -> f64;
    fn screen_recorder_generate_thumbnail(path: *const c_char, time: f64) -> *const c_char;
}

/// Video quality settings
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VideoQuality {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

impl Default for VideoQuality {
    fn default() -> Self {
        VideoQuality {
            width: 1280,  // 720p
            height: 720,
            fps: 15,      // Good balance for filesize/quality
        }
    }
}

/// Video recorder manages screen capture via Swift ScreenCaptureKit
pub struct VideoRecorder {
    #[cfg(target_os = "macos")]
    swift_recorder: Option<*mut std::ffi::c_void>,
    current_session_id: Arc<Mutex<Option<String>>>,
    output_path: Arc<Mutex<Option<PathBuf>>>,
}

// Manual implementation of Send for VideoRecorder
// SAFETY: swift_recorder pointer is only accessed from a single thread
// and protected by the Arc<Mutex<VideoRecorder>> wrapper
unsafe impl Send for VideoRecorder {}
unsafe impl Sync for VideoRecorder {}

impl VideoRecorder {
    pub fn new() -> Self {
        VideoRecorder {
            #[cfg(target_os = "macos")]
            swift_recorder: None,
            current_session_id: Arc::new(Mutex::new(None)),
            output_path: Arc::new(Mutex::new(None)),
        }
    }

    /// Start recording screen for a session
    pub fn start_recording(
        &mut self,
        session_id: String,
        output_path: PathBuf,
        quality: VideoQuality,
    ) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            // Check if already recording
            if self.swift_recorder.is_some() {
                return Err("Already recording".to_string());
            }

            // Check permission
            if !Self::check_permission()? {
                return Err("Screen recording permission not granted. Please enable in System Settings > Privacy & Security > Screen Recording".to_string());
            }

            // Create Swift recorder instance
            let recorder = unsafe { screen_recorder_create() };
            if recorder.is_null() {
                return Err("Failed to create screen recorder".to_string());
            }

            // Convert path to C string
            let path_str = output_path
                .to_str()
                .ok_or("Invalid output path")?;
            let c_path = CString::new(path_str)
                .map_err(|_| "Failed to convert path to C string")?;

            println!("🎬 Starting screen recording for session: {}", session_id);
            println!("   Output: {:?}", output_path);
            println!("   Quality: {}x{} @ {}fps", quality.width, quality.height, quality.fps);

            // Start recording
            let success = unsafe {
                screen_recorder_start(
                    recorder,
                    c_path.as_ptr(),
                    quality.width as i32,
                    quality.height as i32,
                    quality.fps as i32,
                )
            };

            if !success {
                unsafe { screen_recorder_destroy(recorder) };
                return Err("Failed to start screen recording. Check console for details.".to_string());
            }

            self.swift_recorder = Some(recorder);
            *self.current_session_id.lock()
                .map_err(|e| format!("Failed to lock session_id: {}", e))? = Some(session_id.clone());
            *self.output_path.lock()
                .map_err(|e| format!("Failed to lock output_path: {}", e))? = Some(output_path.clone());

            println!("✅ Screen recording started successfully");
            Ok(())
        }

        #[cfg(not(target_os = "macos"))]
        {
            Err("Screen recording only supported on macOS 12.3+".to_string())
        }
    }

    /// Stop recording and save video
    pub fn stop_recording(&mut self) -> Result<PathBuf, String> {
        #[cfg(target_os = "macos")]
        {
            let recorder = self.swift_recorder
                .take()
                .ok_or("No active recording")?;

            println!("⏹️  Stopping screen recording...");

            let success = unsafe { screen_recorder_stop(recorder) };

            if !success {
                println!("⚠️  Failed to stop recording gracefully, but continuing cleanup");
            }

            let path = self.output_path.lock()
                .map_err(|e| format!("Failed to lock output_path: {}", e))?
                .take()
                .ok_or("No output path set")?;

            // Clean up Swift recorder
            unsafe { screen_recorder_destroy(recorder) };
            *self.current_session_id.lock()
                .map_err(|e| format!("Failed to lock session_id: {}", e))? = None;

            println!("✅ Screen recording stopped, video saved to: {:?}", path);
            Ok(path)
        }

        #[cfg(not(target_os = "macos"))]
        {
            Err("Screen recording only supported on macOS 12.3+".to_string())
        }
    }

    /// Check if currently recording
    pub fn is_recording(&self) -> bool {
        #[cfg(target_os = "macos")]
        {
            if let Some(recorder) = self.swift_recorder {
                return unsafe { screen_recorder_is_recording(recorder) };
            }
        }
        false
    }

    /// Check if screen recording permission is granted
    pub fn check_permission() -> Result<bool, String> {
        #[cfg(target_os = "macos")]
        {
            Ok(unsafe { screen_recorder_check_permission() })
        }

        #[cfg(not(target_os = "macos"))]
        {
            Ok(false)
        }
    }

    /// Request screen recording permission
    pub fn request_permission() -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            unsafe { screen_recorder_request_permission() };
            Ok(())
        }

        #[cfg(not(target_os = "macos"))]
        {
            Err("Screen recording only supported on macOS 12.3+".to_string())
        }
    }

    /// Get current session ID if recording
    pub fn current_session_id(&self) -> Option<String> {
        self.current_session_id.lock()
            .ok()
            .and_then(|s| s.clone())
    }
}

impl Drop for VideoRecorder {
    fn drop(&mut self) {
        #[cfg(target_os = "macos")]
        {
            if let Some(recorder) = self.swift_recorder.take() {
                println!("🗑️  Cleaning up video recorder");
                unsafe {
                    screen_recorder_stop(recorder);
                    screen_recorder_destroy(recorder);
                }
            }
        }
    }
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// Tauri command to start video recording
#[tauri::command]
pub async fn start_video_recording(
    session_id: String,
    output_path: String,
    quality: Option<VideoQuality>,
    recorder: State<'_, Arc<Mutex<VideoRecorder>>>,
) -> Result<(), String> {
    let mut recorder = recorder.lock()
        .map_err(|e| format!("Failed to lock video recorder: {}", e))?;
    let quality = quality.unwrap_or_default();
    let path = PathBuf::from(output_path);

    recorder.start_recording(session_id, path, quality)
}

/// Tauri command to stop video recording
#[tauri::command]
pub async fn stop_video_recording(
    recorder: State<'_, Arc<Mutex<VideoRecorder>>>,
) -> Result<String, String> {
    let mut recorder = recorder.lock()
        .map_err(|e| format!("Failed to lock video recorder: {}", e))?;
    let path = recorder.stop_recording()?;
    Ok(path.to_string_lossy().to_string())
}

/// Tauri command to check if currently recording
#[tauri::command]
pub async fn is_recording(
    recorder: State<'_, Arc<Mutex<VideoRecorder>>>,
) -> Result<bool, String> {
    let recorder = recorder.lock()
        .map_err(|e| format!("Failed to lock video recorder: {}", e))?;
    Ok(recorder.is_recording())
}

/// Tauri command to get current session ID if recording
#[tauri::command]
pub async fn get_current_recording_session(
    recorder: State<'_, Arc<Mutex<VideoRecorder>>>,
) -> Result<Option<String>, String> {
    let recorder = recorder.lock()
        .map_err(|e| format!("Failed to lock video recorder: {}", e))?;
    Ok(recorder.current_session_id())
}

/// Tauri command to get video duration in seconds
#[tauri::command]
pub async fn get_video_duration(video_path: String) -> Result<f64, String> {
    #[cfg(target_os = "macos")]
    {
        let c_path = CString::new(video_path)
            .map_err(|_| "Invalid video path")?;

        let duration = unsafe { screen_recorder_get_duration(c_path.as_ptr()) };
        Ok(duration)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Video duration extraction only supported on macOS".to_string())
    }
}

/// Tauri command to generate video thumbnail
#[tauri::command]
pub async fn generate_video_thumbnail(video_path: String, time: Option<f64>) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        use std::ffi::CStr;

        let c_path = CString::new(video_path)
            .map_err(|_| "Invalid video path")?;

        let time = time.unwrap_or(1.0); // Default to 1 second into video

        let thumbnail_ptr = unsafe { screen_recorder_generate_thumbnail(c_path.as_ptr(), time) };

        if thumbnail_ptr.is_null() {
            return Err("Failed to generate thumbnail".to_string());
        }

        // Convert C string to Rust String
        let thumbnail = unsafe {
            CStr::from_ptr(thumbnail_ptr)
                .to_string_lossy()
                .into_owned()
        };

        // Free the C string (allocated by Swift's strdup)
        unsafe {
            libc::free(thumbnail_ptr as *mut libc::c_void);
        }

        Ok(thumbnail)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("Thumbnail generation only supported on macOS".to_string())
    }
}
