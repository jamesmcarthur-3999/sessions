/**
 * Database Types for Session Intelligence
 */

// Core session record
export interface DbSession {
  id: string;
  type: 'session' | 'capture';
  title: string;
  created_at: string;
  updated_at: string;
  duration_seconds: number | null;
  status: 'recording' | 'processing' | 'complete' | 'error';
  analysis_mode: 'ambient' | 'deep';
}

// Screenshot captures
export interface DbScreenshot {
  id: string;
  session_id: string;
  captured_at: string;
  trigger: 'interval' | 'app_switch' | 'activity' | 'manual' | 'session_start' | 'session_end';
  app_name: string | null;
  window_title: string | null;
  data_base64: string;
  analysis: string | null; // JSON string of AI analysis
}

// Audio chunks
export interface DbAudioChunk {
  id: string;
  session_id: string;
  start_time: string;
  end_time: string;
  duration_seconds: number;
  data_base64: string;
  transcript: string | null;
}

// AI-generated insights
export interface DbInsight {
  id: string;
  session_id: string;
  created_at: string;
  type: 'activity' | 'summary' | 'moment' | 'suggestion';
  content: string;
  metadata: string | null; // JSON string
  pinned: boolean;
}

// Rolling summary (living document)
export interface DbRollingSummary {
  id: string;
  session_id: string;
  updated_at: string;
  content: string;
  version: number;
}

// Chat messages
export interface DbChatMessage {
  id: string;
  session_id: string;
  created_at: string;
  role: 'user' | 'assistant';
  content: string;
  metadata: string | null; // JSON string
}

// Analysis state
export interface DbAnalysisState {
  session_id: string;
  mode: 'ambient' | 'deep';
  last_screenshot_id: string | null;
  last_audio_chunk_id: string | null;
  updated_at: string;
}
