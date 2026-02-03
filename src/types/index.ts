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

  // Raw data
  captureText?: string;
  attachments?: Attachment[];

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
