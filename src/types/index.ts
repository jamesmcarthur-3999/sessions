/**
 * Sessions - Core Types
 *
 * Simple, flat types. No over-engineering.
 */

import type { RecordingConfig } from '../components/RecordingSettings';

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

// Screenshot during session recording
export interface Screenshot {
  id: string;
  timestamp: number;
  attachmentId: string;
}

// Audio segment during session recording
export interface AudioSegment {
  id: string;
  startTime: number;
  endTime: number;
  attachmentId: string;
}

// Result from stopping a recording session
export interface RecordingStopResult {
  sessionId: string;
  isRecording: boolean;
  isPaused: boolean;
  screenshots: string[];
  audioChunks: string[];
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
