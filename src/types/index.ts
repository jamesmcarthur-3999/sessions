/**
 * Sessions - Core Types
 *
 * Simple, flat types. No over-engineering.
 */

/**
 * Simplified recording configuration (v2)
 * Everything else is automatic - screenshot timing, analysis mode, etc.
 */
export interface RecordingConfig {
  /** Array of screen IDs to record (multi-screen support) */
  selectedScreens: string[];
  /** Microphone device ID, or null for no audio */
  selectedMicrophone: string | null;
}

/** Default configuration for new recordings */
export const defaultRecordingConfig: RecordingConfig = {
  selectedScreens: [],
  selectedMicrophone: null,
};

export interface Session {
  id: string;
  type: 'session' | 'capture';
  title: string;
  createdAt: string;
  duration?: number; // seconds, for recorded sessions
  status?: 'recording' | 'processing' | 'complete' | 'error' | 'interrupted';

  // Raw data
  captureText?: string;
  attachments?: Attachment[];
  videoPath?: string;

  // AI output
  summary?: Summary;

  // Recording configuration (for session type)
  recordingConfig?: RecordingConfig;
}

export interface Summary {
  text: string;
  tasks: Task[];
  notes: Note[];
  generatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  completed: boolean;
}

export interface Note {
  id: string;
  content: string;
}

export interface Attachment {
  id: string;
  type: 'image' | 'audio' | 'video' | 'file';
  name: string;
  path: string;
  mimeType: string;
  size: number;
}

// Result from stopping a recording session
export interface RecordingStopResult {
  sessionId: string;
  isRecording: boolean;
  isPaused: boolean;
  /** Count of screenshots captured (data stored on disk, not in memory) */
  screenshotCount: number;
  /** Count of audio chunks captured (data stored on disk, not in memory) */
  audioChunkCount: number;
  videoPath?: string;
  startTime: number;
  options: {
    enableScreenshots: boolean;
    enableAudio: boolean;
    enableVideo: boolean;
    screenshotIntervalMs: number;
    selectedMicrophone: string | null;
    selectedScreen: string | null;
    smartCaptureEnabled: boolean;
  };
  stopErrors?: string[];
}
