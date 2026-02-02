/**
 * Audio Capture Module
 *
 * Implements real-time audio recording with:
 * - System audio capture using cpal
 * - Configurable chunk buffering (matches screenshot interval)
 * - WAV encoding with hound
 * - Base64 transmission to frontend
 * - State management (recording/paused/stopped)
 */

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, Stream, StreamConfig};
use hound::{WavSpec, WavWriter};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

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
            buffer: Arc::new(Mutex::new(AudioBuffer::new(120))), // Default 120s, will be reset on start
            stream: Arc::new(Mutex::new(None)),
            session_id: Arc::new(Mutex::new(None)),
            app_handle: Arc::new(Mutex::new(None)),
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
    pub fn start_recording(&self, session_id: String, chunk_duration_secs: u64, device_id: Option<String>) -> Result<(), String> {
        println!("🎤 [AUDIO CAPTURE] Starting recording for session: {} (chunk duration: {}s, device: {:?})", session_id, chunk_duration_secs, device_id);

        // Check if already recording
        let current_state = self.state.lock()
            .map_err(|e| format!("Failed to lock state: {}", e))?.clone();
        if current_state == RecordingState::Recording {
            println!("⚠️  [AUDIO CAPTURE] Already recording");
            return Ok(());
        }

        // Store session ID
        *self.session_id.lock()
            .map_err(|e| format!("Failed to lock session_id: {}", e))? = Some(session_id.clone());

        // Recreate buffer with the specified chunk duration
        *self.buffer.lock()
            .map_err(|e| format!("Failed to lock buffer: {}", e))? = AudioBuffer::new(chunk_duration_secs);

        // Get input device - either by ID or default
        let host = cpal::default_host();
        let device = if let Some(id) = device_id {
            // Find device by index (ID is the index as string)
            let idx: usize = id.parse().map_err(|_| format!("Invalid device ID: {}", id))?;
            let mut devices = host.input_devices()
                .map_err(|e| format!("Failed to enumerate input devices: {}", e))?;
            devices.nth(idx).ok_or_else(|| format!("Device not found: {}", id))?
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

        // Build stream based on sample format
        let stream = match config.sample_format() {
            SampleFormat::F32 => self.build_stream_f32(&device, config.into())?,
            SampleFormat::I16 => self.build_stream_i16(&device, config.into())?,
            SampleFormat::U16 => self.build_stream_u16(&device, config.into())?,
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
    fn build_stream_f32(&self, device: &Device, config: StreamConfig) -> Result<Stream, String> {
        let buffer = self.buffer.clone();
        let state = self.state.clone();

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
    fn build_stream_i16(&self, device: &Device, config: StreamConfig) -> Result<Stream, String> {
        let buffer = self.buffer.clone();
        let state = self.state.clone();

        let stream = device
            .build_input_stream(
                &config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    if let Ok(current_state) = state.lock() {
                        if *current_state == RecordingState::Recording {
                            if let Ok(mut buf) = buffer.lock() {
                                for &sample in data {
                                    // Convert i16 to f32
                                    let normalized = sample as f32 / i16::MAX as f32;
                                    buf.push_sample(normalized);
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
    fn build_stream_u16(&self, device: &Device, config: StreamConfig) -> Result<Stream, String> {
        let buffer = self.buffer.clone();
        let state = self.state.clone();

        let stream = device
            .build_input_stream(
                &config,
                move |data: &[u16], _: &cpal::InputCallbackInfo| {
                    if let Ok(current_state) = state.lock() {
                        if *current_state == RecordingState::Recording {
                            if let Ok(mut buf) = buffer.lock() {
                                for &sample in data {
                                    // Convert u16 to f32
                                    let normalized = (sample as f32 / u16::MAX as f32) * 2.0 - 1.0;
                                    buf.push_sample(normalized);
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

        std::thread::spawn(move || {
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

                // Convert to WAV and base64
                match Self::samples_to_wav_base64(&samples, sample_rate, 1) {
                    Ok(base64_data) => {
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

                            // Emit audio-chunk event to frontend
                            let payload = serde_json::json!({
                                "sessionId": sid,
                                "audioBase64": base64_data,
                                "duration": duration,
                            });

                            if let Err(e) = app.emit("audio-chunk", payload) {
                                eprintln!("❌ [AUDIO CAPTURE] Failed to emit audio-chunk event: {}", e);
                            } else {
                                println!("✅ [AUDIO CAPTURE] Emitted audio chunk ({:.1}s)", duration);
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("❌ [AUDIO CAPTURE] Failed to encode audio: {}", e);
                    }
                }
            }

            println!("🛑 [AUDIO CAPTURE] Chunk processor thread exiting");
        });
    }

    /// Resample audio from source sample rate to 16kHz using linear interpolation
    fn resample_to_16khz(samples: &[f32], source_rate: u32) -> Vec<f32> {
        if source_rate == 16000 {
            return samples.to_vec(); // Already 16kHz
        }

        let target_rate = 16000;
        let ratio = source_rate as f64 / target_rate as f64;
        let output_length = (samples.len() as f64 / ratio) as usize;
        let mut resampled = Vec::with_capacity(output_length);

        for i in 0..output_length {
            let src_idx = (i as f64 * ratio) as usize;
            if src_idx < samples.len() {
                resampled.push(samples[src_idx]);
            }
        }

        resampled
    }

    /// Convert audio samples to WAV format and encode as base64
    fn samples_to_wav_base64(samples: &[f32], sample_rate: u32, channels: u16) -> Result<String, String> {
        let mut wav_buffer = Vec::new();

        // Resample to 16kHz for optimal speech recognition
        let resampled = Self::resample_to_16khz(samples, sample_rate);
        let target_rate = 16000;

        {
            let spec = WavSpec {
                channels,
                sample_rate: target_rate, // Use 16kHz
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            };

            let mut writer = WavWriter::new(std::io::Cursor::new(&mut wav_buffer), spec)
                .map_err(|e| format!("Failed to create WAV writer: {}", e))?;

            // Convert f32 samples to i16 and write
            for &sample in &resampled { // Use resampled data
                let amplitude = i16::MAX as f32;
                let sample_i16 = (sample * amplitude) as i16;
                writer
                    .write_sample(sample_i16)
                    .map_err(|e| format!("Failed to write sample: {}", e))?;
            }

            writer
                .finalize()
                .map_err(|e| format!("Failed to finalize WAV: {}", e))?;
        }

        // Encode to base64
        let base64_data = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &wav_buffer);
        Ok(format!("data:audio/wav;base64,{}", base64_data))
    }

    /// Pause recording
    pub fn pause_recording(&self) -> Result<(), String> {
        println!("⏸️  [AUDIO CAPTURE] Pausing recording");
        *self.state.lock()
            .map_err(|e| format!("Failed to lock state: {}", e))? = RecordingState::Paused;
        Ok(())
    }

    /// Resume recording
    #[allow(dead_code)]
    pub fn resume_recording(&self) -> Result<(), String> {
        println!("▶️  [AUDIO CAPTURE] Resuming recording");
        let current_state = self.state.lock()
            .map_err(|e| format!("Failed to lock state: {}", e))?.clone();

        if current_state == RecordingState::Stopped {
            return Err("Cannot resume - recording is stopped".to_string());
        }

        *self.state.lock()
            .map_err(|e| format!("Failed to lock state: {}", e))? = RecordingState::Recording;
        Ok(())
    }

    /// Stop recording
    pub fn stop_recording(&self) -> Result<(), String> {
        println!("🛑 [AUDIO CAPTURE] Stopping recording");

        // Update state first to signal threads to stop
        *self.state.lock()
            .map_err(|e| format!("Failed to lock state: {}", e))? = RecordingState::Stopped;

        // Drop the stream (this will stop it)
        *self.stream.lock()
            .map_err(|e| format!("Failed to lock stream: {}", e))? = None;

        // Clear buffer
        self.buffer.lock()
            .map_err(|e| format!("Failed to lock buffer: {}", e))?.clear();

        // Clear session ID
        *self.session_id.lock()
            .map_err(|e| format!("Failed to lock session_id: {}", e))? = None;

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

// No global static - we'll use Tauri's managed state instead
