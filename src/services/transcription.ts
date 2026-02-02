/**
 * Transcription Service
 *
 * Handles audio transcription using:
 * - OpenAI Whisper API (primary)
 * - Local Whisper (future)
 */

interface TranscriptionResult {
  text: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
  language?: string;
}

interface TranscriptionConfig {
  provider: 'openai' | 'local';
  model: string;
}

const defaultConfig: TranscriptionConfig = {
  provider: 'openai',
  model: 'whisper-1',
};

class TranscriptionService {
  private config: TranscriptionConfig = defaultConfig;

  /**
   * Get OpenAI API key from localStorage
   */
  private getOpenAIApiKey(): string | null {
    try {
      return localStorage.getItem('sessions_openai_api_key');
    } catch {
      return null;
    }
  }

  /**
   * Transcribe audio from base64 data
   */
  async transcribe(audioBase64: string): Promise<TranscriptionResult> {
    const apiKey = this.getOpenAIApiKey();

    if (!apiKey) {
      console.warn('[TRANSCRIPTION] No OpenAI API key configured, skipping transcription');
      return { text: '' };
    }

    if (this.config.provider === 'openai') {
      return this.transcribeWithOpenAI(audioBase64, apiKey);
    }

    throw new Error(`Unsupported transcription provider: ${this.config.provider}`);
  }

  /**
   * Transcribe using OpenAI Whisper API
   */
  private async transcribeWithOpenAI(
    audioBase64: string,
    apiKey: string
  ): Promise<TranscriptionResult> {
    // Strip data URL prefix if present
    const base64Data = audioBase64.replace(/^data:audio\/\w+;base64,/, '');

    // Convert base64 to blob
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const audioBlob = new Blob([bytes], { type: 'audio/wav' });

    // Create form data
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.wav');
    formData.append('model', this.config.model);
    formData.append('response_format', 'verbose_json');

    try {
      console.log('[TRANSCRIPTION] Sending audio to Whisper API...');

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[TRANSCRIPTION] API error:', response.status, error);
        throw new Error(`Transcription failed: ${error}`);
      }

      const result = await response.json();

      console.log('[TRANSCRIPTION] Received transcript:', result.text?.substring(0, 100) + '...');

      return {
        text: result.text || '',
        segments: result.segments?.map((s: { start: number; end: number; text: string }) => ({
          start: s.start,
          end: s.end,
          text: s.text,
        })),
        language: result.language,
      };
    } catch (error) {
      console.error('[TRANSCRIPTION] Error:', error);
      return { text: '' };
    }
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<TranscriptionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Check if transcription is available (OpenAI API key set)
   */
  isAvailable(): boolean {
    return !!this.getOpenAIApiKey();
  }
}

export const transcriptionService = new TranscriptionService();
