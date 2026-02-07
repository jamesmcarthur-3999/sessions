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

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, Stream, StreamConfig};
use hound::{WavSpec, WavWriter};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// Target sample rate for WAV output (optimal for Whisper speech recognition)
const TARGET_SAMPLE_RATE: u32 = 16000;
/// Target sample rate for live PCM output (required by OpenAI Realtime API)
const PCM_TARGET_SAMPLE_RATE: u32 = 24000;

/// Scale factor to normalize typical speech RMS (~0.33) to full [0, 1] range
const RMS_NORMALIZATION_FACTOR: f32 = 3.0;

/// Emit audio level events every ~100ms at 48kHz
const LEVEL_EMISSION_INTERVAL: u32 = 4800;

/// Emit PCM chunks to frontend every 500ms for live transcription
const PCM_EMISSION_INTERVAL: Duration = Duration::from_millis(500);

/// Audio level event payload for frontend visualization
#[derive(Clone, serde::Serialize)]
struct AudioLevelEvent {
    level: f32,
}

/// PCM audio chunk event payload for live transcription
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioPcmEvent {
    session_id: String,
    pcm_base64: String,
    sample_rate: u32,
    encoding: String,
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
}

// SAFETY: AudioRecorder is safe to send/share across threads because:
// 1. All mutable state (stream, buffer, session_id, etc.) is behind Arc<Mutex<T>>
// 2. cpal::Stream is !Send on macOS but is only accessed through Mutex<Option<Stream>>
// 3. Stream operations (play/pause) are called only while holding the mutex lock
// 4. The chunk processor thread accesses shared state only through Arc<Mutex<T>>
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
        log::info!("🎤 [AUDIO CAPTURE] Starting recording for session: {} (chunk duration: {}s, device: {:?})", session_id, chunk_duration_secs, device_id);

        // Check if already recording
        let current_state = self.state.lock()
            .map_err(|e| format!("Failed to lock state: {}", e))?.clone();
        if current_state == RecordingState::Recording {
            log::warn!("⚠️  [AUDIO CAPTURE] Already recording");
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

        log::info!("🎤 [AUDIO CAPTURE] Audio directory: {:?}", session_audio_dir);

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

        log::info!("🎤 [AUDIO CAPTURE] Using device: {}", device.name().unwrap_or_else(|_| "Unknown".to_string()));

        // Get device config
        let config = device
            .default_input_config()
            .map_err(|e| format!("Failed to get default input config: {}", e))?;

        log::info!("🎤 [AUDIO CAPTURE] Sample format: {:?}, Sample rate: {}, Channels: {}",
            config.sample_format(), config.sample_rate().0, config.channels());

        // Store sample rate (device's native rate, e.g., 44100)
        let sample_rate = config.sample_rate().0;

        // Get app handle for audio level emission
        let app_handle = self.app_handle.lock()
            .map_err(|e| format!("Failed to lock app_handle: {}", e))?
            .clone();

        // Build stream based on sample format, with appropriate normalization
        let stream = match config.sample_format() {
            SampleFormat::F32 => self.build_stream::<f32>(&device, config.into(), app_handle, |s| s)?,
            SampleFormat::I16 => self.build_stream::<i16>(&device, config.into(), app_handle, |s| s as f32 / i16::MAX as f32)?,
            SampleFormat::U16 => self.build_stream::<u16>(&device, config.into(), app_handle, |s| (s as f32 / u16::MAX as f32) * 2.0 - 1.0)?,
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

        log::info!("✅ [AUDIO CAPTURE] Recording started");
        Ok(())
    }

    /// Build an audio input stream for a given sample type.
    /// The `normalize` closure converts each raw sample to f32 in [-1, 1].
    fn build_stream<S: cpal::SizedSample + Send + 'static>(
        &self,
        device: &Device,
        config: StreamConfig,
        app_handle: Option<AppHandle>,
        normalize: fn(S) -> f32,
    ) -> Result<Stream, String> {
        let buffer = self.buffer.clone();
        let state = self.state.clone();

        // Counter for throttling audio level emissions (~100ms at 48kHz)
        let level_sample_count = Arc::new(AtomicU32::new(0));
        let level_sample_count_clone = level_sample_count.clone();

        let stream = device
            .build_input_stream(
                &config,
                move |data: &[S], _: &cpal::InputCallbackInfo| {
                    if let Ok(current_state) = state.lock() {
                        if *current_state == RecordingState::Recording {
                            let mut sum_sq: f32 = 0.0;
                            if let Ok(mut buf) = buffer.lock() {
                                for &sample in data {
                                    let normalized = normalize(sample);
                                    buf.push_sample(normalized);
                                    sum_sq += normalized * normalized;
                                }
                            }

                            // Use boundary-crossing detection for consistent timing
                            let prev_count = level_sample_count_clone.fetch_add(data.len() as u32, Ordering::Relaxed);
                            let new_count = prev_count + data.len() as u32;

                            if prev_count / LEVEL_EMISSION_INTERVAL != new_count / LEVEL_EMISSION_INTERVAL {
                                let rms = (sum_sq / data.len() as f32).sqrt();
                                let normalized_level = (rms * RMS_NORMALIZATION_FACTOR).min(1.0);

                                if let Some(handle) = &app_handle {
                                    let _ = handle.emit("audio-level", AudioLevelEvent { level: normalized_level });
                                }
                            }
                        }
                    }
                },
                |err| log::error!("❌ [AUDIO CAPTURE] Stream error: {}", err),
                None,
            )
            .map_err(|e| format!("Failed to build input stream: {}", e))?;

        Ok(stream)
    }

    /// Convert f32 samples to PCM16 i16 bytes and encode as base64
    fn samples_to_pcm16_base64(samples: &[f32]) -> String {
        let mut bytes = Vec::with_capacity(samples.len() * 2);
        for &sample in samples {
            let clamped = sample.clamp(-1.0, 1.0);
            let i16_sample = (clamped * i16::MAX as f32) as i16;
            bytes.extend_from_slice(&i16_sample.to_le_bytes());
        }
        BASE64.encode(&bytes)
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
            // PCM emission state — accumulates samples between 500ms emissions
            let mut pcm_buffer: Vec<f32> = Vec::new();
            let mut pcm_last_emit = Instant::now();
            // Track last buffer length to detect new samples (avoid holding lock)
            let mut last_known_buffer_len: usize = 0;

            loop {
                // Poll at 100ms for responsive PCM emission
                std::thread::sleep(Duration::from_millis(100));

                let Ok(s) = state.lock() else { break };
                let current_state = s.clone();
                drop(s);

                if current_state == RecordingState::Stopped {
                    break;
                }

                if current_state != RecordingState::Recording {
                    continue;
                }

                // ── PCM emission path (every 500ms) ──────────────────────────
                // Peek at current buffer to accumulate samples for PCM
                {
                    let Ok(b) = buffer.lock() else { continue };
                    let current_len = b.samples.len();
                    if current_len > last_known_buffer_len {
                        // New samples since last check — copy them to PCM buffer
                        pcm_buffer.extend_from_slice(&b.samples[last_known_buffer_len..]);
                    }
                    last_known_buffer_len = current_len;
                }

                if pcm_last_emit.elapsed() >= PCM_EMISSION_INTERVAL && !pcm_buffer.is_empty() {
                    // Resample to 24kHz for OpenAI Realtime API
                    let resampled = Self::resample_to_24khz(&pcm_buffer, sample_rate);
                    pcm_buffer.clear();
                    pcm_last_emit = Instant::now();

                    if !resampled.is_empty() {
                        let Ok(app) = app_handle.lock().map(|h| h.clone()) else { continue };
                        let Ok(sess_id) = session_id.lock().map(|s| s.clone()) else { continue };

                        if let (Some(app), Some(sid)) = (&app, &sess_id) {
                            let pcm_base64 = Self::samples_to_pcm16_base64(&resampled);
                            let event = AudioPcmEvent {
                                session_id: sid.clone(),
                                pcm_base64,
                                sample_rate: PCM_TARGET_SAMPLE_RATE,
                                encoding: "pcm16".to_string(),
                            };
                            let _ = app.emit("audio-pcm", event);
                        }
                    }
                }

                // ── WAV chunk archival path (existing behavior) ──────────────
                let Ok(mut b) = buffer.lock() else { continue };
                if !b.is_chunk_ready() { continue; }
                let samples = b.take_samples();
                last_known_buffer_len = 0; // Buffer was just drained

                // Flush remaining PCM before clearing to avoid gaps in live transcription
                if !pcm_buffer.is_empty() {
                    let remaining = Self::resample_to_24khz(&pcm_buffer, sample_rate);
                    if !remaining.is_empty() {
                        let Ok(app) = app_handle.lock().map(|h| h.clone()) else {
                            pcm_buffer.clear();
                            drop(b);
                            continue;
                        };
                        let Ok(sess_id) = session_id.lock().map(|s| s.clone()) else {
                            pcm_buffer.clear();
                            drop(b);
                            continue;
                        };
                        if let (Some(app), Some(sid)) = (&app, &sess_id) {
                            let pcm_base64 = Self::samples_to_pcm16_base64(&remaining);
                            let event = AudioPcmEvent {
                                session_id: sid.clone(),
                                pcm_base64,
                                sample_rate: PCM_TARGET_SAMPLE_RATE,
                                encoding: "pcm16".to_string(),
                            };
                            let _ = app.emit("audio-pcm", event);
                        }
                    }
                }
                pcm_buffer.clear();
                pcm_last_emit = Instant::now();
                drop(b);

                if samples.is_empty() {
                    continue;
                }

                log::info!("🎤 [AUDIO CAPTURE] Processing chunk: {} samples", samples.len());

                // Get audio directory
                let Ok(dir_guard) = audio_dir.lock() else { continue };
                let dir_opt = dir_guard.clone();
                drop(dir_guard);
                let Some(dir) = dir_opt else {
                    log::error!("❌ [AUDIO CAPTURE] No audio directory set");
                    continue;
                };

                // Generate chunk filename with counter
                let chunk_num = chunk_counter.fetch_add(1, Ordering::SeqCst);
                let chunk_id = format!("chunk_{:04}", chunk_num);
                let file_path = dir.join(format!("{}.wav", chunk_id));

                // Save WAV file to disk
                match Self::samples_to_wav_file(&samples, sample_rate, 1, &file_path) {
                    Ok(()) => {
                        let Ok(app) = app_handle.lock().map(|h| h.clone()) else { continue };
                        let Ok(sess_id) = session_id.lock().map(|s| s.clone()) else { continue };

                        if let (Some(app), Some(sid)) = (app, sess_id) {
                            let duration = samples.len() as f64 / sample_rate as f64;
                            let file_path_str = file_path.to_string_lossy().to_string();

                            let payload = serde_json::json!({
                                "sessionId": sid,
                                "chunkId": chunk_id,
                                "audioPath": file_path_str,
                                "duration": duration,
                            });

                            let payload_clone = payload.clone();
                            let emit_result = app.emit("audio-chunk", payload)
                                .or_else(|_| {
                                    std::thread::sleep(Duration::from_millis(50));
                                    app.emit("audio-chunk", payload_clone)
                                });

                            if let Err(e) = emit_result {
                                log::error!("❌ [AUDIO CAPTURE] Failed to emit audio-chunk event after retry: {}", e);
                                if let Err(del_err) = std::fs::remove_file(&file_path) {
                                    log::error!("❌ [AUDIO CAPTURE] Failed to clean up orphaned file {}: {}", file_path.display(), del_err);
                                }
                            } else {
                                log::info!("✅ [AUDIO CAPTURE] Saved audio chunk: {} ({:.1}s)", file_path_str, duration);
                            }
                        }
                    }
                    Err(e) => {
                        log::error!("❌ [AUDIO CAPTURE] Failed to save audio file: {}", e);
                    }
                }
            }

            log::info!("🛑 [AUDIO CAPTURE] Chunk processor thread exiting");
        });

        if let Ok(mut h) = self.chunk_processor_handle.lock() {
            *h = Some(handle);
        }
    }

    /// Resample audio from source sample rate to a target rate using linear interpolation
    fn resample(samples: &[f32], source_rate: u32, target_rate: u32) -> Vec<f32> {
        if source_rate == target_rate {
            return samples.to_vec(); // Already at target rate
        }

        let ratio = source_rate as f64 / target_rate as f64;
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

    /// Resample to 16kHz (WAV output for Whisper)
    fn resample_to_16khz(samples: &[f32], source_rate: u32) -> Vec<f32> {
        Self::resample(samples, source_rate, TARGET_SAMPLE_RATE)
    }

    /// Resample to 24kHz (live PCM for OpenAI Realtime)
    fn resample_to_24khz(samples: &[f32], source_rate: u32) -> Vec<f32> {
        Self::resample(samples, source_rate, PCM_TARGET_SAMPLE_RATE)
    }

    /// Save audio samples directly to WAV file
    /// Resamples to 16kHz for optimal speech recognition
    fn samples_to_wav_file(samples: &[f32], sample_rate: u32, channels: u16, file_path: &PathBuf) -> Result<(), String> {
        // Resample to target rate for optimal speech recognition
        let resampled = Self::resample_to_16khz(samples, sample_rate);

        let spec = WavSpec {
            channels,
            sample_rate: TARGET_SAMPLE_RATE,
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
        log::info!("⏸️  [AUDIO CAPTURE] Pausing recording");
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
        log::info!("▶️  [AUDIO CAPTURE] Resuming recording");
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
        log::info!("🛑 [AUDIO CAPTURE] Stopping recording");

        // 1. Signal the chunk processor thread to stop
        *self.state.lock()
            .map_err(|e| format!("Failed to lock state: {}", e))? = RecordingState::Stopped;

        // 2. Join chunk processor thread FIRST (it checks state and exits)
        if let Ok(mut handle) = self.chunk_processor_handle.lock() {
            if let Some(h) = handle.take() {
                if let Err(e) = h.join() {
                    log::error!("❌ [AUDIO CAPTURE] Chunk processor thread panicked: {:?}", e);
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

        log::info!("✅ [AUDIO CAPTURE] Recording stopped");
        Ok(())
    }

}

impl Drop for AudioRecorder {
    fn drop(&mut self) {
        // Skip cleanup if already stopped (stop_recording handles everything)
        if let Ok(state) = self.state.lock() {
            if *state == RecordingState::Stopped {
                return;
            }
        }

        // 1. Signal stop
        if let Ok(mut state) = self.state.lock() {
            *state = RecordingState::Stopped;
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

        log::info!("AudioRecorder dropped, resources cleaned up");
    }
}

// No global static - we'll use Tauri's managed state instead
