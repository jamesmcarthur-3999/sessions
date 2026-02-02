/**
 * ScreenRecorder - Screen Recording via ScreenCaptureKit
 *
 * Provides screen recording functionality using Apple's ScreenCaptureKit framework.
 * Exposes C-compatible functions for Rust FFI integration.
 *
 * Requirements: macOS 12.3+
 */

import Foundation
import ScreenCaptureKit
import AVFoundation

// MARK: - C-Compatible Global Functions (for Rust FFI)

/// Create a new ScreenRecorder instance
@_cdecl("screen_recorder_create")
public func screen_recorder_create() -> UnsafeMutableRawPointer {
    let recorder = ScreenRecorder()
    return Unmanaged.passRetained(recorder).toOpaque()
}

/// Start screen recording
@_cdecl("screen_recorder_start")
public func screen_recorder_start(
    recorder: UnsafeMutableRawPointer,
    path: UnsafePointer<CChar>,
    width: Int32,
    height: Int32,
    fps: Int32
) -> Bool {
    let instance = Unmanaged<ScreenRecorder>.fromOpaque(recorder).takeUnretainedValue()
    let pathString = String(cString: path)

    print("🎬 ScreenRecorder.start called with path: \(pathString)")

    let semaphore = DispatchSemaphore(value: 0)
    var success = false

    instance.width = width
    instance.height = height
    instance.fps = fps

    Task {
        do {
            try await instance.startRecording(path: pathString)
            success = true
        } catch {
            print("❌ Failed to start recording: \(error)")
            success = false
        }
        semaphore.signal()
    }

    semaphore.wait()
    return success
}

/// Stop screen recording
@_cdecl("screen_recorder_stop")
public func screen_recorder_stop(recorder: UnsafeMutableRawPointer) -> Bool {
    let instance = Unmanaged<ScreenRecorder>.fromOpaque(recorder).takeUnretainedValue()

    print("⏹️  ScreenRecorder.stop called")

    let semaphore = DispatchSemaphore(value: 0)
    var success = false

    Task {
        do {
            try await instance.stopRecording()
            success = true
        } catch {
            print("❌ Failed to stop recording: \(error)")
            success = false
        }
        semaphore.signal()
    }

    semaphore.wait()
    return success
}

/// Check if currently recording
@_cdecl("screen_recorder_is_recording")
public func screen_recorder_is_recording(recorder: UnsafeMutableRawPointer) -> Bool {
    let instance = Unmanaged<ScreenRecorder>.fromOpaque(recorder).takeUnretainedValue()
    return instance.isRecording
}

/// Destroy recorder instance
@_cdecl("screen_recorder_destroy")
public func screen_recorder_destroy(recorder: UnsafeMutableRawPointer) {
    let instance = Unmanaged<ScreenRecorder>.fromOpaque(recorder).takeRetainedValue()

    // Ensure recording is stopped
    if instance.isRecording {
        _ = screen_recorder_stop(recorder: recorder)
    }

    // instance will be deallocated after this scope
    print("🗑️  ScreenRecorder destroyed")
}

/// Check if screen recording permission is granted
@_cdecl("screen_recorder_check_permission")
public func screen_recorder_check_permission() -> Bool {
    print("🔐 Checking screen recording permission...")

    // Try to get shareable content - this will fail if permission is not granted
    let semaphore = DispatchSemaphore(value: 0)
    var hasPermission = false

    Task {
        do {
            _ = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            hasPermission = true
            print("✅ Screen recording permission granted")
        } catch {
            print("❌ Screen recording permission denied or error: \(error)")
            hasPermission = false
        }
        semaphore.signal()
    }

    semaphore.wait()
    return hasPermission
}

/// Request screen recording permission
@_cdecl("screen_recorder_request_permission")
public func screen_recorder_request_permission() {
    // On macOS 12.3-13.x, permission is automatically requested on first capture attempt
    // There's no explicit API to request it beforehand
    print("⚠️  Permission will be requested on first recording attempt")
    print("   If denied, user must grant permission in System Settings > Privacy & Security > Screen Recording")
}

/// Get video duration in seconds
@_cdecl("screen_recorder_get_duration")
public func screen_recorder_get_duration(path: UnsafePointer<CChar>) -> Double {
    let pathString = String(cString: path)
    let url = URL(fileURLWithPath: pathString)

    let asset = AVURLAsset(url: url)
    let duration = asset.duration
    let seconds = CMTimeGetSeconds(duration)

    print("📊 Video duration: \(seconds) seconds")
    return seconds
}

/// Generate video thumbnail as base64 PNG
@_cdecl("screen_recorder_generate_thumbnail")
public func screen_recorder_generate_thumbnail(
    path: UnsafePointer<CChar>,
    time: Double
) -> UnsafePointer<CChar>? {
    let pathString = String(cString: path)
    let url = URL(fileURLWithPath: pathString)

    do {
        let asset = AVURLAsset(url: url)
        let imageGenerator = AVAssetImageGenerator(asset: asset)
        imageGenerator.appliesPreferredTrackTransform = true
        imageGenerator.maximumSize = CGSize(width: 320, height: 180) // 16:9 thumbnail

        let cmTime = CMTime(seconds: time, preferredTimescale: 600)
        let cgImage = try imageGenerator.copyCGImage(at: cmTime, actualTime: nil)

        // Convert to PNG data
        let nsImage = NSImage(cgImage: cgImage, size: .zero)
        guard let tiffData = nsImage.tiffRepresentation,
              let bitmapImage = NSBitmapImageRep(data: tiffData),
              let pngData = bitmapImage.representation(using: .png, properties: [:]) else {
            print("❌ Failed to generate PNG data")
            return nil
        }

        // Convert to base64
        let base64String = "data:image/png;base64," + pngData.base64EncodedString()

        print("✅ Generated thumbnail (\(pngData.count) bytes)")

        // Return as C string (caller must free)
        let cString = strdup(base64String)
        return UnsafePointer(cString)
    } catch {
        print("❌ Failed to generate thumbnail: \(error)")
        return nil
    }
}

// MARK: - ScreenRecorder Class

@available(macOS 12.3, *)
public class ScreenRecorder: NSObject {
    private var stream: SCStream?
    private var assetWriter: AVAssetWriter?
    private var videoInput: AVAssetWriterInput?
    private var pixelBufferAdaptor: AVAssetWriterInputPixelBufferAdaptor?
    private var streamOutput: ScreenRecorderStreamOutput? // Keep output handler alive
    fileprivate var isRecording = false
    private var outputURL: URL?
    private var startTime: CMTime?
    private var frameCount: Int64 = 0

    // Configuration
    fileprivate var width: Int32 = 1280
    fileprivate var height: Int32 = 720
    fileprivate var fps: Int32 = 15

    // Codec detection - lazy property to test HEVC availability once
    private lazy var codecConfiguration: (codec: AVVideoCodecType, profile: String) = {
        // Test HEVC availability by attempting to create a test AVAssetWriter
        let tempURL = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("hevc_test.mp4")

        do {
            // Clean up any existing test file
            if FileManager.default.fileExists(atPath: tempURL.path) {
                try? FileManager.default.removeItem(at: tempURL)
            }

            // Try to create an asset writer with HEVC
            let testWriter = try AVAssetWriter(url: tempURL, fileType: .mp4)

            let hevcSettings: [String: Any] = [
                AVVideoCodecKey: AVVideoCodecType.hevc,
                AVVideoWidthKey: 1280,
                AVVideoHeightKey: 720
            ]

            let testInput = AVAssetWriterInput(mediaType: .video, outputSettings: hevcSettings)

            if testWriter.canAdd(testInput) {
                // HEVC is supported
                print("✅ HEVC codec is available - will use HEVC encoding for reduced file sizes")

                // Clean up test file
                try? FileManager.default.removeItem(at: tempURL)

                // HEVC doesn't use AVVideoProfileLevelKey - encoder chooses optimal profile
                return (.hevc, "")
            } else {
                // HEVC not supported
                print("⚠️  HEVC codec not available - falling back to H.264 encoding")

                // Clean up test file
                try? FileManager.default.removeItem(at: tempURL)

                return (.h264, AVVideoProfileLevelH264HighAutoLevel)
            }
        } catch {
            // Error testing HEVC - fall back to H.264
            print("⚠️  Error testing HEVC codec: \(error) - falling back to H.264 encoding")

            // Clean up test file
            try? FileManager.default.removeItem(at: tempURL)

            return (.h264, AVVideoProfileLevelH264HighAutoLevel)
        }
    }()

    fileprivate func startRecording(path: String) async throws {
        guard !isRecording else {
            print("⚠️  Already recording")
            return
        }

        // Convert path to URL
        let url = URL(fileURLWithPath: path)
        self.outputURL = url

        // Ensure directory exists
        let directory = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        // Get shareable content (displays, windows, etc.)
        print("📋 Getting shareable content...")
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)

        guard let display = content.displays.first else {
            throw ScreenRecorderError.noDisplayFound
        }

        print("🖥️  Found display: \(display.displayID)")

        // Create content filter (capture entire display)
        let filter = SCContentFilter(display: display, excludingWindows: [])

        // Configure stream settings
        let config = SCStreamConfiguration()
        config.width = Int(width)
        config.height = Int(height)
        config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
        config.queueDepth = 5
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.showsCursor = true

        print("⚙️  Configuration: \(width)x\(height) @ \(fps)fps")

        // Set up AVAssetWriter
        try setupAssetWriter(url: url)

        // Create stream
        print("🔧 Creating SCStream with filter and config...")
        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        self.stream = stream
        print("✅ SCStream created")

        // Add stream output (store as property to keep it alive!)
        print("🔧 Adding stream output handler...")
        let output = ScreenRecorderStreamOutput(recorder: self)
        self.streamOutput = output // Keep strong reference to prevent deallocation
        let queue = DispatchQueue(label: "com.taskerino.screenrecorder")
        try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: queue)
        print("✅ Stream output handler added on queue: \(queue.label)")

        // Set recording flag BEFORE starting capture to avoid race condition
        // (frames can arrive on background thread immediately after startCapture)
        isRecording = true
        startTime = CMTime.zero
        print("🎬 Set isRecording = true BEFORE starting capture")

        // Start capture
        print("🔧 Starting capture...")
        try await stream.startCapture()
        print("✅ Capture started")

        print("✅ Recording started successfully - isRecording: \(isRecording)")
    }

    fileprivate func stopRecording() async throws {
        guard isRecording else {
            print("⚠️  Not currently recording")
            return
        }

        isRecording = false

        // Stop stream
        if let stream = stream {
            try await stream.stopCapture()
            self.stream = nil
        }

        // Finalize video file
        if let videoInput = videoInput {
            videoInput.markAsFinished()
        }

        if let assetWriter = assetWriter {
            await assetWriter.finishWriting()

            if assetWriter.status == .completed {
                print("✅ Video saved to: \(outputURL?.path ?? "unknown")")
            } else if let error = assetWriter.error {
                print("❌ Asset writer failed: \(error)")
                throw error
            }
        }

        // Cleanup
        self.assetWriter = nil
        self.videoInput = nil
        self.pixelBufferAdaptor = nil
        self.outputURL = nil
        self.startTime = nil
        self.streamOutput = nil // Release output handler
        self.frameCount = 0

        print("✅ Recording stopped successfully")
    }

    private func setupAssetWriter(url: URL) throws {
        // Remove existing file if present
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }

        // Create asset writer
        let writer = try AVAssetWriter(url: url, fileType: .mp4)

        // Configure video settings with detected codec (HEVC or H.264 fallback)
        let codecConfig = codecConfiguration
        print("📹 Using codec: \(codecConfig.codec.rawValue)")

        // Build compression properties - only add profile level for H.264
        var compressionProperties: [String: Any] = [
            AVVideoAverageBitRateKey: 1_200_000, // 1.2 Mbps
            AVVideoExpectedSourceFrameRateKey: fps
        ]

        // Add profile level only for H.264 (HEVC uses automatic profile selection)
        if !codecConfig.profile.isEmpty {
            compressionProperties[AVVideoProfileLevelKey] = codecConfig.profile
        }

        let videoSettings: [String: Any] = [
            AVVideoCodecKey: codecConfig.codec,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: compressionProperties
        ]

        // Create video input
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        input.expectsMediaDataInRealTime = true

        // Create pixel buffer adaptor for BGRA format
        let sourcePixelBufferAttributes: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height
        ]

        let adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: input,
            sourcePixelBufferAttributes: sourcePixelBufferAttributes
        )

        guard writer.canAdd(input) else {
            throw ScreenRecorderError.cannotAddInput
        }

        writer.add(input)

        self.assetWriter = writer
        self.videoInput = input
        self.pixelBufferAdaptor = adaptor

        // Start writing session
        writer.startWriting()
        writer.startSession(atSourceTime: .zero)

        print("✅ Asset writer configured with pixel buffer adaptor")
    }

    fileprivate func processFrame(sampleBuffer: CMSampleBuffer) {
        guard isRecording,
              let videoInput = videoInput,
              let assetWriter = assetWriter,
              let adaptor = pixelBufferAdaptor else {
            return
        }

        // Ensure writer is ready
        guard assetWriter.status == .writing else {
            if let error = assetWriter.error {
                print("❌ Asset writer error: \(error)")
            }
            return
        }

        // Wait until input is ready
        guard videoInput.isReadyForMoreMediaData else {
            return
        }

        // Get IOSurface from sample buffer attachments (ScreenCaptureKit uses IOSurface-backed buffers)
        guard let attachmentsArray = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[CFString: Any]],
              let attachments = attachmentsArray.first else {
            if frameCount == 0 {
                print("❌ No attachments in sample buffer")
            }
            return
        }

        // Try to get pixel buffer from sample buffer
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            if frameCount == 0 {
                print("❌ Failed to get pixel buffer from sample - attachments: \(attachments.keys)")
            }
            return
        }

        // Calculate presentation timestamp
        let presentationTime = CMTime(value: frameCount, timescale: CMTimeScale(fps))
        frameCount += 1

        // Append pixel buffer
        if !adaptor.append(pixelBuffer, withPresentationTime: presentationTime) {
            if let error = assetWriter.error {
                print("❌ Failed to append pixel buffer: \(error)")
            }
        } else {
            if frameCount % 30 == 0 { // Log every 30 frames to reduce spam
                print("✅ [PROCESS FRAME] Frame \(frameCount) written successfully")
            }
        }
    }
}

// MARK: - Stream Output Handler

@available(macOS 12.3, *)
private class ScreenRecorderStreamOutput: NSObject, SCStreamOutput {
    weak var recorder: ScreenRecorder?

    init(recorder: ScreenRecorder) {
        self.recorder = recorder
        super.init()
        print("🎬 ScreenRecorderStreamOutput initialized")
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen else {
            return
        }
        recorder?.processFrame(sampleBuffer: sampleBuffer)
    }
}

// MARK: - Stream Delegate

@available(macOS 12.3, *)
extension ScreenRecorder: SCStreamDelegate {
    public func stream(_ stream: SCStream, didStopWithError error: Error) {
        print("❌ [STREAM DELEGATE] Stream stopped with error: \(error)")
        print("❌ [STREAM DELEGATE] Error details: \(error.localizedDescription)")
        isRecording = false
    }

    // This method might be called on some macOS versions
    public func streamDidBecomeActive(_ stream: SCStream) {
        print("✅ [STREAM DELEGATE] Stream became active")
    }
}

// MARK: - Errors

enum ScreenRecorderError: Error {
    case noDisplayFound
    case cannotAddInput
    case alreadyRecording
    case notRecording
}
