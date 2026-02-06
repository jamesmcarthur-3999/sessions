/**
 * Live Transcription Session (Web Worker)
 *
 * Implements OpenAI Realtime WebSocket protocol directly in the Worker context.
 * No BaleyBots imports — Worker dynamic imports can't resolve Node-style package
 * specifiers at runtime. The protocol is simple enough to implement directly:
 *
 * 1. Fetch ephemeral token via REST (native fetch in Worker)
 * 2. Connect WebSocket with token in URL (browser WS can't set custom headers)
 * 3. Send session.update init message
 * 4. Stream audio as input_audio_buffer.append messages (base64 PCM16)
 * 5. Receive transcript events via WebSocket messages
 */

/// <reference lib="webworker" />

// ============================================================================
// Types
// ============================================================================

export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
  confidence?: number;
  words?: Array<{ word: string; start: number; end: number; confidence?: number }>;
  language?: string;
  startTime?: number;
  endTime?: number;
}

export type SessionEvent =
  | { kind: 'transcript'; event: TranscriptEvent }
  | { kind: 'speech_started' }
  | { kind: 'speech_ended' }
  | { kind: 'error'; error: Error };

export interface LiveSession {
  sendAudio(data: ArrayBuffer | Uint8Array): void;
  close(): void;
  readonly state: 'connecting' | 'open' | 'closing' | 'closed';
}

// ============================================================================
// Ephemeral Token
// ============================================================================

interface EphemeralTokenResponse {
  client_secret: {
    value: string;
    expires_at: number;
  };
}

/**
 * Fetch an ephemeral token from OpenAI's Realtime sessions endpoint.
 * This short-lived token is safe to use in browser/Worker context.
 */
async function fetchEphemeralToken(openaiKey: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-realtime-preview',
      modalities: ['text'],
      input_audio_transcription: {
        model: 'whisper-1',
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown error');
    throw new Error(`Failed to fetch ephemeral token (${response.status}): ${text}`);
  }

  const data = (await response.json()) as EphemeralTokenResponse;
  return data.client_secret.value;
}

// ============================================================================
// Uint8Array → base64 (chunked to avoid stack overflow on large buffers)
// ============================================================================

function uint8ArrayToBase64(data: Uint8Array): string {
  const chunkSize = 8192;
  const chunks: string[] = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    const slice = data.subarray(i, Math.min(i + chunkSize, data.length));
    chunks.push(String.fromCharCode(...slice));
  }
  return btoa(chunks.join(''));
}

// ============================================================================
// OpenAI Realtime Session (direct WebSocket implementation)
// ============================================================================

class OpenAIRealtimeSession implements LiveSession {
  private ws: WebSocket | null = null;
  private _state: LiveSession['state'] = 'connecting';
  private audioBuffer: Array<ArrayBuffer | Uint8Array> = [];
  private onEvent: (event: SessionEvent) => void;

  constructor(onEvent: (event: SessionEvent) => void) {
    this.onEvent = onEvent;
  }

  get state(): LiveSession['state'] {
    return this._state;
  }

  /**
   * Connect to OpenAI Realtime API via WebSocket.
   * Auth is via ephemeral token in URL query parameter.
   */
  async connect(token: string): Promise<void> {
    const model = 'gpt-4o-realtime-preview';
    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}&client_secret=${encodeURIComponent(token)}`;

    this.ws = new WebSocket(url);

    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('WebSocket connection timed out (10s)'));
      }, 10000);

      this.ws!.onopen = () => {
        clearTimeout(timeoutId);
        this._state = 'open';

        // Send session configuration
        this.ws!.send(JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['text'],
            input_audio_transcription: {
              model: 'whisper-1',
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              silence_duration_ms: 500,
            },
          },
        }));

        // Flush any audio buffered during connection
        for (const chunk of this.audioBuffer) {
          this.sendAudioToWs(chunk);
        }
        this.audioBuffer = [];

        resolve();
      };

      this.ws!.onerror = () => {
        clearTimeout(timeoutId);
        reject(new Error('WebSocket connection error'));
      };

      this.ws!.onclose = (event: CloseEvent) => {
        clearTimeout(timeoutId);
        reject(new Error(`WebSocket closed during connect (code: ${event.code})`));
      };
    });

    // Wire up ongoing message handlers (replaces connection handlers)
    this.wireMessageHandlers();
  }

  sendAudio(data: ArrayBuffer | Uint8Array): void {
    if (this._state === 'closed' || this._state === 'closing') return;

    // Buffer if not yet connected
    if (this._state === 'connecting' || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.audioBuffer.push(data);
      return;
    }

    this.sendAudioToWs(data);
  }

  close(): void {
    if (this._state === 'closed' || this._state === 'closing') return;

    this._state = 'closing';
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, 'Session closed by client');
    }
    this._state = 'closed';
    this.ws = null;
    this.audioBuffer = [];
  }

  private sendAudioToWs(data: ArrayBuffer | Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.ws.send(JSON.stringify({
      type: 'input_audio_buffer.append',
      audio: uint8ArrayToBase64(bytes),
    }));
  }

  private wireMessageHandlers(): void {
    if (!this.ws) return;

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as { type?: string; [key: string]: unknown };
        if (!msg.type) return;

        switch (msg.type) {
          case 'conversation.item.input_audio_transcription.completed':
            this.onEvent({
              kind: 'transcript',
              event: {
                text: (msg.transcript as string) ?? '',
                isFinal: true,
                startTime: msg.start_time as number | undefined,
                endTime: msg.end_time as number | undefined,
              },
            });
            break;

          case 'input_audio_buffer.speech_started':
            this.onEvent({ kind: 'speech_started' });
            break;

          case 'input_audio_buffer.speech_stopped':
            this.onEvent({ kind: 'speech_ended' });
            break;

          case 'error': {
            const error = msg.error as { message?: string } | undefined;
            this.onEvent({
              kind: 'error',
              error: new Error(`OpenAI Realtime: ${error?.message ?? 'Unknown error'}`),
            });
            break;
          }

          // Ignore other events: session.created, session.updated, etc.
        }
      } catch (err) {
        this.onEvent({
          kind: 'error',
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    };

    this.ws.onerror = () => {
      this.onEvent({
        kind: 'error',
        error: new Error('WebSocket connection error'),
      });
    };

    this.ws.onclose = () => {
      if (this._state !== 'closing') {
        this._state = 'closed';
        this.onEvent({
          kind: 'error',
          error: new Error('WebSocket connection closed unexpectedly'),
        });
      }
      this._state = 'closed';
      this.ws = null;
    };
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Start a live transcription session with ephemeral token auth.
 *
 * Flow:
 * 1. POST to OpenAI REST API with permanent key -> get ephemeral token
 * 2. Connect WebSocket with token in URL
 * 3. Send session.update init message
 * 4. Return connected LiveSession ready to receive audio
 */
export async function startLiveTranscription(
  openaiKey: string,
  onEvent: (event: SessionEvent) => void
): Promise<LiveSession> {
  const token = await fetchEphemeralToken(openaiKey);
  const session = new OpenAIRealtimeSession(onEvent);
  await session.connect(token);
  return session;
}

/**
 * Stop a live transcription session gracefully.
 */
export function stopLiveTranscription(session: LiveSession): void {
  session.close();
}
