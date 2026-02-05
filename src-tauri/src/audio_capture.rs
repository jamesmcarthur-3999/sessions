/**
 * Audio Capture Module
 *
 * Implements real-time audio recording with:
 * - System audio capture using cpal
 * - Configurable chunk buffering (matches screenshot interval)
 * - WAV encoding with hound
 * - File-based storage (returns file paths, not base64)
 * - State management (recording/paused/stopped)
 */

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, Stream, StreamConfig};
use hound::{WavSpec, WavWriter};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// Audio level event payload for frontend visualization
#[derive(Clone, serde::Serialize)]
struct AudioLevelEvent {
    level: f32,
}

/// Audio recording state
#[derive(Debug, Clone, PartialEq)]
pub enum RecordingState {
    Stopped,
    Recording,
    Paused,
}

/// Audio buffer for storing samples
struct AudioBuffer {
    samples: Vec<f32>,
    start_time: Instant,
    chunk_duration: Duration,
}

impl AudioBuffer {
    fn new(chunk_duration_secs: u64) -> Self {
        Self {
            samples: Vec::new(),
            start_time: Instant::now(),
            chunk_duration: Duration::from_secs(chunk_duration_secs),
        }
    }

    fn push_sample(&mut self, sample: f32) {
        self.samples.push(sample);
    }

    fn is_chunk_ready(&self) -> bool {
        self.start_time.elapsed() >= self.chunk_duration
    }

    fn take_samples(&mut self) -> Vec<f32> {
        let samples = std::mem::take(&mut self.samples);
        self.start_time = Instant::now();
        samples
    }

    fn clear(&mut self) {
        self.samples.clear();
        self.start_time = Instant::now();
    }
}

/// Global audio recorder state
pub struct AudioRecorder {
    state: Arc<Mutex<RecordingState>>,
    buffer: Arc<Mutex<AudioBuffer>>,
    stream: Arc<Mutex<Option<Stream>>>,
    session_id: Arc<Mutex<Option<String>>>,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
    audio_dir: Arc<Mutex<Option<PathBuf>>>,
    chunk_counter: Arc<AtomicU32>,
    chunk_processor_handle: Arc<Mutex<Option<std::thread::JoinHandle<()>>>>,
    #[allow(dead_code)]
    sample_rate: u32,
}

// SAFETY: AudioRecorder uses Mutex for all internal state synchronization,
// making it safe to share across threads despite Stream not being Send/Sync on macOS
unsafe impl Send for AudioRecorder {}
unsafe impl Sync for AudioRecorder {}

impl AudioRecorder {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(RecordingState::Stopped)),
            buffer: Arc::new(Mutex::new(AudioBuffer::new(10))), // Default 10s chunks for faster transcription
            stream: Arc::new(Mutex::new(None)),
            session_id: Arc::new(Mutex::new(None)),
            app_handle: Arc::new(Mutex::new(None)),
            audio_dir: Arc::new(Mutex::new(None)),
            chunk_counter: Arc::new(AtomicU32::new(0)),
            chunk_processor_handle: Arc::new(Mutex::new(None)),
            sample_rate: 44100, // Default sample rate
        }
    }

    /// Initialize the audio recorder with app handle
    pub fn init(&self, app_handle: AppHandle) -> Result<(), String> {
        *self.app_handle.lock()
            .map_err(|e| format!("Failed to lock app_handle: {}", e))? = Some(app_handle);
        Ok(())
    }

    /// Start recording audio
    pub fn start_recording(&self, session_id: String, chunk_duration_secs: u64, device_id: Option<String>, app_handle: &AppHandle) -> Result<(), String> {
        println!("🎤 [AUDIO CAPTURE] Starting recording for session: {} (chunk duration: {}s, device: {:?})", session_id, chunk_duration_secs, device_id);

        // Check if already recording
        let current_state = self.state.lock()
            .map_err(|e| format!("Failed to lock state: {}", e))?.clone();
        if current_state == RecordingState::Recording {
            println!("⚠️  [AUDIO CAPTURE] Already recording");
            return Ok(());
        }

        // Set up audio directory: {appDataDir}/audio/{sessionId}/
        let app_data_dir = app_handle.path().app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {}", e))?;
        let audio_base_dir = app_data_dir.join("audio");
        let session_audio_dir = audio_base_dir.join(&session_id);

        // Create directories if they don't exist
        fs::create_dir_all(&session_audio_dir)
            .map_err(|e| format!("Failed to create audio directory: {}", e))?;

        println!("🎤 [AUDIO CAPTURE] Audio directory: {:?}", session_audio_dir);

        // Store audio directory
        *self.audio_dir.lock()
            .map_err(|e| format!("Failed to lock audio_dir: {}", e))? = Some(session_audio_dir);

        // Reset chunk counter
        self.chunk_counter.store(0, Ordering::SeqCst);

        // Store session ID
        *self.session_id.lock()
            .map_err(|e| format!("Failed to lock session_id: {}", e))? = Some(session_id.clone());

        // Recreate buffer with the specified chunk duration
        *self.buffer.lock()
            .map_err(|e| format!("Failed to lock buffer: {}", e))? = AudioBuffer::new(chunk_duration_secs);

        // Get input device - either by name (stable ID) or default
        let host = cpal::default_host();
        let device = if let Some(device_name) = device_id {
            // Find device by name (stable ID that survives enumeration changes)
            let devices = host.input_devices()
                .map_err(|e| format!("Failed to enumerate input devices: {}", e))?;
            devices
                .filter_map(|d| d.name().ok().map(|n| (d, n)))
                .find(|(_, name)| name == &device_name)
                .map(|(d, _)| d)
                .ok_or_else(|| format!("Device not found: {}", device_name))?
        } else {
            host.default_input_device()
                .ok_or_else(|| "No input device available".to_string())?
        };

        println!("🎤 [AUDIO CAPTURE] Using device: {}", device.name().unwrap_or_else(|_| "Unknown".to_string()));

        // Get device config
        let config = device
            .default_input_config()
            .map_err(|e| format!("Failed to get default input config: {}", e))?;

        println!("🎤 [AUDIO CAPTURE] Sample format: {:?}, Sample rate: {}, Channels: {}",
            config.sample_format(), config.sample_rate().0, config.channels());

        // Store sample rate (device's native rate, e.g., 44100)
        let sample_rate = config.sample_rate().0;

        // Get app handle for audio level emission
        let app_handle = self.app_handle.lock()
            .map_err(|e| format!("Failed to lock app_handle: {}", e))?
            .clone();

        // Build stream based on sample format
        let stream = match config.sample_format() {
            SampleFormat::F32 => self.build_stream_f32(&device, config.into(), app_handle)?,
            SampleFormat::I16 => self.build_stream_i16(&device, config.into(), app_handle)?,
            SampleFormat::U16 => self.build_stream_u16(&device, config.into(), app_handle)?,
            _ => return Err(format!("Unsupported sample format: {:?}", config.sample_format())),
        };

        // Start the stream
        stream
            .play()
            .map_err(|e| format!("Failed to start audio stream: {}", e))?;

        // Store stream
        *self.stream.lock()
            .map_err(|e| format!("Failed to lock stream: {}", e))? = Some(stream);

        // Update state
        *self.state.lock()
            .map_err(|e| format!("Failed to lock state: {}", e))? = RecordingState::Recording;

        // Clear buffer
        self.buffer.lock()
            .map_err(|e| format!("Failed to lock buffer: {}", e))?.clear();

        // Start background thread to check for completed chunks
        self.start_chunk_processor(sample_rate);

        println!("✅ [AUDIO CAPTURE] Recording started");
        Ok(())
    }

    /// Build audio stream for f32 samples
    fn build_stream_f32(&self, device: &Device, config: StreamConfig, app_handle: Option<AppHandle>) -> Result<Stream, String> {
        let buffer = self.buffer.clone();
        let state = self.state.clone();

        // Counter for throttling audio level emissions (~100ms at 48kHz)
        let level_sample_count = Arc::new(AtomicU32::new(0));
        let level_sample_count_clone = level_sample_count.clone();

        let stream = device
            .build_input_stream(
                &config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    if let Ok(current_state) = state.lock() {
                        if *current_state == RecordingState::Recording {
                            if let Ok(mut buf) = buffer.lock() {
                                for &sample in data {
                                    buf.push_sample(sample);
                                }
                            }

                            // Calculate and emit audio level every ~4800 samples (~100ms at 48kHz)
                            // Use boundary-crossing detection for consistent timing
                            const LEVEL_INTERVAL: u32 = 4800;
                            let prev_count = level_sample_count_clone.fetch_add(data.len() as u32, Ordering::Relaxed);
                            let new_count = prev_count + data.len() as u32;

                            // Emit when we cross a boundary (every ~100ms)
                            if prev_count / LEVEL_INTERVAL != new_count / LEVEL_INTERVAL {
                                let sum: f32 = data.iter().map(|&s| s * s).sum();
                                let rms = (sum / data.len() as f32).sqrt();
                                // Scale factor of 3.0 normalizes typical speech RMS (~0.33) to full range
                                let normalized_level = (rms * 3.0).min(1.0);

                                if let Some(handle) = &app_handle {
                                    let _ = handle.emit("audio-level", AudioLevelEvent { level: normalized_level });
                                }
                            }
                        }
                    }
                },
                |err| eprintln!("❌ [AUDIO CAPTURE] Stream error: {}", err),
                None,
            )
            .map_err(|e| format!("Failed to build input stream: {}", e))?;

        Ok(stream)
    }

    /// Build audio stream for i16 samples (convert to f32)
    fn build_stream_i16(&self, device: &Device, config: StreamConfig, app_handle: Option<AppHandle>) -> Result<Stream, String> {
        let buffer = self.buffer.clone();
        let state = self.state.clone();

        // Counter for throttling audio level emissions
        let level_sample_count = Arc::new(AtomicU32::new(0));
        let level_sample_count_clone = level_sample_count.clone();

        let stream = device
            .build_input_stream(
                &config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    if let Ok(current_state) = state.lock() {
                        if *current_state == RecordingState::Recording {
                            // Convert samples and calculate RMS in one pass
                            let mut sum_sq: f32 = 0.0;
                            if let Ok(mut buf) = buffer.lock() {
                                for &sample in data {
                                    // Convert i16 to f32
                                    let normalized = sample as f32 / i16::MAX as f32;
                                    buf.push_sample(normalized);
                                    sum_sq += normalized * normalized;
                                }
                            }

                            // Emit audio level every ~4800 samples (~100ms at 48kHz)
                            // Use boundary-crossing detection for consistent timing
                            const LEVEL_INTERVAL: u32 = 4800;
                            let prev_count = level_sample_count_clone.fetch_add(data.len() as u32, Ordering::Relaxed);
                            let new_count = prev_count + data.len() as u32;

                            if prev_count / LEVEL_INTERVAL != new_count / LEVEL_INTERVAL {
                                let rms = (sum_sq / data.len() as f32).sqrt();
                                let normalized_level = (rms * 3.0).min(1.0);

                                if let Some(handle) = &app_handle {
                                    let _ = handle.emit("audio-level", AudioLevelEvent { level: normalized_level });
                                }
                            }
                        }
                    }
                },
                |err| eprintln!("❌ [AUDIO CAPTURE] Stream error: {}", err),
                None,
            )
            .map_err(|e| format!("Failed to build input stream: {}", e))?;

        Ok(stream)
    }

    /// Build audio stream for u16 samples (convert to f32)
    fn build_stream_u16(&self, device: &Device, config: StreamConfig, app_handle: Option<AppHandle>) -> Result<Stream, String> {
        let buffer = self.buffer.clone();
        let state = self.state.clone();

        // Counter for throttling audio level emissions
        let level_sample_count = Arc::new(AtomicU32::new(0));
        let level_sample_count_clone = level_sample_count.clone();

        let stream = device
            .build_input_stream(
                &config,
                move |data: &[u16], _: &cpal::InputCallbackInfo| {
                    if let Ok(current_state) = state.lock() {
                        if *current_state == RecordingState::Recording {
                            // Convert samples and calculate RMS in one pass
                            let mut sum_sq: f32 = 0.0;
                            if let Ok(mut buf) = buffer.lock() {
                                for &sample in data {
                                    // Convert u16 to f32
                                    let normalized = (sample as f32 / u16::MAX as f32) * 2.0 - 1.0;
                                    buf.push_sample(normalized);
                                    sum_sq += normalized * normalized;
                                }
                            }

                            // Emit audio level every ~4800 samples (~100ms at 48kHz)
                            // Use boundary-crossing detection for consistent timing
                            const LEVEL_INTERVAL: u32 = 4800;
                            let prev_count = level_sample_count_clone.fetch_add(data.len() as u32, Ordering::Relaxed);
                            let new_count = prev_count + data.len() as u32;

                            if prev_count / LEVEL_INTERVAL != new_count / LEVEL_INTERVAL {
                                let rms = (sum_sq / data.len() as f32).sqrt();
                                let normalized_level = (rms * 3.0).min(1.0);

                                if let Some(handle) = &app_handle {
                                    let _ = handle.emit("audio-level", AudioLevelEvent { level: normalized_level });
                                }
                            }
                        }
                    }
                },
                |err| eprintln!("❌ [AUDIO CAPTURE] Stream error: {}", err),
                None,
            )
            .map_err(|e| format!("Failed to build input stream: {}", e))?;

        Ok(stream)
    }

    /// Start background thread to process audio chunks
    fn start_chunk_processor(&self, sample_rate: u32) {
        let buffer = self.buffer.clone();
        let state = self.state.clone();
        let app_handle = self.app_handle.clone();
        let session_id = self.session_id.clone();
        let audio_dir = self.audio_dir.clone();
        let chunk_counter = self.chunk_counter.clone();

        let handle = std::thread::spawn(move || {
            loop {
                std::thread::sleep(Duration::from_secs(1)); // Check every second

                let current_state = match state.lock() {
                    Ok(s) => s.clone(),
                    Err(_) => break, // Exit on lock failure
                };

                if current_state == RecordingState::Stopped {
                    break; // Exit thread when recording stopped
                }

                if current_state != RecordingState::Recording {
                    continue; // Skip if paused
                }

                // Check if chunk is ready
                let is_ready = match buffer.lock() {
                    Ok(b) => b.is_chunk_ready(),
                    Err(_) => continue,
                };
                if !is_ready {
                    continue;
                }

                // Take samples from buffer
                let samples = match buffer.lock() {
                    Ok(mut b) => b.take_samples(),
                    Err(_) => continue,
                };
                if samples.is_empty() {
                    continue;
                }

                println!("🎤 [AUDIO CAPTURE] Processing chunk: {} samples", samples.len());

                // Get audio directory
                let dir = match audio_dir.lock() {
                    Ok(d) => d.clone(),
                    Err(_) => continue,
                };

                let Some(dir) = dir else {
                    eprintln!("❌ [AUDIO CAPTURE] No audio directory set");
                    continue;
                };

                // Generate chunk filename with counter
                let chunk_num = chunk_counter.fetch_add(1, Ordering::SeqCst);
                let chunk_id = format!("chunk_{:04}", chunk_num);
                let file_path = dir.join(format!("{}.wav", chunk_id));

                // Save WAV file to disk
                match Self::samples_to_wav_file(&samples, sample_rate, 1, &file_path) {
                    Ok(()) => {
                        // Get app handle and session ID
                        let app = match app_handle.lock() {
                            Ok(h) => h.clone(),
                            Err(_) => continue,
                        };
                        let sess_id = match session_id.lock() {
                            Ok(s) => s.clone(),
                            Err(_) => continue,
                        };

                        if let (Some(app), Some(sid)) = (app, sess_id) {
                            // Calculate duration
                            let duration = samples.len() as f64 / sample_rate as f64;
                            let file_path_str = file_path.to_string_lossy().to_string();

                            // Emit audio-chunk event to frontend with file path (not base64)
                            let payload = serde_json::json!({
                                "sessionId": sid,
                                "chunkId": chunk_id,
                                "audioPath": file_path_str,
                                "duration": duration,
                            });

                            if let Err(e) = app.emit("audio-chunk", payload) {
                                eprintln!("❌ [AUDIO CAPTURE] Failed to emit audio-chunk event: {}", e);
                                // Clean up orphaned file since frontend won't know about it
                                if let Err(del_err) = std::fs::remove_file(&file_path) {
                                    eprintln!("❌ [AUDIO CAPTURE] Failed to clean up orphaned file {}: {}", file_path.display(), del_err);
                                }
                            } else {
                                println!("✅ [AUDIO CAPTURE] Saved audio chunk: {} ({:.1}s)", file_path_str, duration);
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("❌ [AUDIO CAPTURE] Failed to save audio file: {}", e);
                    }
                }
            }

            println!("🛑 [AUDIO CAPTURE] Chunk processor thread exiting");
        });

        if let Ok(mut h) = self.chunk_processor_handle.lock() {
            *h = Some(handle);
        }
    }

    /// Resample audio from source sample rate to 16kHz using linear interpolation
    fn resample_to_16khz(samples: &[f32], source_rate: u32) -> Vec<f32> {
        if source_rate == 16000 {
            return samples.to_vec(); // Already 16kHz
        }

        let ratio = source_rate as f64 / 16000.0;
        let output_length = (samples.len() as f64 / ratio) as usize;
        let mut resampled = Vec::with_capacity(output_length);

        for i in 0..output_length {
            let src_pos = i as f64 * ratio;
            let src_idx = src_pos as usize;
            let frac = (src_pos - src_idx as f64) as f32;

            if src_idx + 1 < samples.len() {
                // Linear interpolation between adjacent samples
                resampled.push(samples[src_idx] * (1.0 - frac) + samples[src_idx + 1] * frac);
            } else if src_idx < samples.len() {
                resampled.push(samples[src_idx]);
            }
        }

        resampled
    }

    /// Save audio samples directly to WAV file
    /// Resamples to 16kHz for optimal speech recognition
    fn samples_to_wav_file(samples: &[f32], sample_rate: u32, channels: u16, file_path: &PathBuf) -> Result<(), String> {
        // Resample to 16kHz for optimal speech recognition
        let resampled = Self::resample_to_16khz(samples, sample_rate);
        let target_rate = 16000;

        let spec = WavSpec {
            channels,
            sample_rate: target_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };

        let mut writer = WavWriter::create(file_path, spec)
            .map_err(|e| format!("Failed to create WAV file: {}", e))?;

        // Convert f32 samples to i16 and write
        for &sample in &resampled {
            let amplitude = i16::MAX as f32;
            let sample_i16 = (sample * amplitude) as i16;
            writer
                .write_sample(sample_i16)
                .map_err(|e| format!("Failed to write sample: {}", e))?;
        }

        writer
            .finalize()
            .map_err(|e| format!("Failed to finalize WAV: {}", e))?;

        Ok(())
    }

    /// Pause recording
    pub fn pause_recording(&self) -> Result<(), String> {
        println!("⏸️  [AUDIO CAPTURE] Pausing recording");
        *self.state.lock()
            .map_err(|e| format!("Failed to lock state: {}", e))? = RecordingState::Paused;

        // Pause the audio stream to save CPU
        if let Ok(stream_opt) = self.stream.lock() {
            if let Some(ref stream) = *stream_opt {
                let _ = stream.pause();
            }
        }
        Ok(())
    }

    /// Resume recording
    pub fn resume_recording(&self) -> Result<(), String> {
        println!("▶️  [AUDIO CAPTURE] Resuming recording");
        let current_state = self.state.lock()
            .map_err(|e| format!("Failed to lock state: {}", e))?.clone();

        if current_state == RecordingState::Stopped {
            return Err("Cannot resume - recording is stopped".to_string());
        }

        // Resume the audio stream
        if let Ok(stream_opt) = self.stream.lock() {
            if let Some(ref stream) = *stream_opt {
                let _ = stream.play();
            }
        }

        *self.state.lock()
            .map_err(|e| format!("Failed to lock state: {}", e))? = RecordingState::Recording;
        Ok(())
    }

    /// Stop recording
    pub fn stop_recording(&self) -> Result<(), String> {
        println!("🛑 [AUDIO CAPTURE] Stopping recording");

        // 1. Signal the chunk processor thread to stop
        *self.state.lock()
            .map_err(|e| format!("Failed to lock state: {}", e))? = RecordingState::Stopped;

        // 2. Join chunk processor thread FIRST (it checks state and exits)
        if let Ok(mut handle) = self.chunk_processor_handle.lock() {
            if let Some(h) = handle.take() {
                if let Err(e) = h.join() {
                    eprintln!("❌ [AUDIO CAPTURE] Chunk processor thread panicked: {:?}", e);
                }
            }
        }

        // 3. Now safe to drop the stream (thread is done)
        *self.stream.lock()
            .map_err(|e| format!("Failed to lock stream: {}", e))? = None;

        // 4. Clear remaining state
        self.buffer.lock()
            .map_err(|e| format!("Failed to lock buffer: {}", e))?.clear();
        *self.session_id.lock()
            .map_err(|e| format!("Failed to lock session_id: {}", e))? = None;
        *self.audio_dir.lock()
            .map_err(|e| format!("Failed to lock audio_dir: {}", e))? = None;

        println!("✅ [AUDIO CAPTURE] Recording stopped");
        Ok(())
    }

    /// Get current recording state
    #[allow(dead_code)]
    pub fn get_state(&self) -> RecordingState {
        self.state.lock()
            .map(|s| s.clone())
            .unwrap_or(RecordingState::Stopped)
    }

    /// Check if currently recording
    #[allow(dead_code)]
    pub fn is_recording(&self) -> bool {
        self.state.lock()
            .map(|s| *s == RecordingState::Recording)
            .unwrap_or(false)
    }
}

impl Drop for AudioRecorder {
    fn drop(&mut self) {
        // 1. Signal stop
        if let Ok(mut state) = self.state.lock() {
            if *state != RecordingState::Stopped {
                *state = RecordingState::Stopped;
            }
        }

        // 2. Join chunk processor thread FIRST
        if let Ok(mut handle) = self.chunk_processor_handle.lock() {
            if let Some(h) = handle.take() {
                let _ = h.join();
            }
        }

        // 3. Now safe to drop the stream
        if let Ok(mut stream) = self.stream.lock() {
            *stream = None;
        }

        println!("AudioRecorder dropped, resources cleaned up");
    }
}

// No global static - we'll use Tauri's managed state instead
