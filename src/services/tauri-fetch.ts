/**
 * Tauri Fetch
 *
 * A custom fetch implementation that routes HTTP requests through
 * Tauri's Rust backend, bypassing browser CORS restrictions.
 *
 * This allows baleybots to make direct API calls from a Tauri app
 * without needing a separate proxy server.
 */

import { isTauri } from './recording';

// Dynamic import cache for invoke function
// We use dynamic import to avoid loading @tauri-apps/api/core before Tauri is ready
let invokeFunction: typeof import('@tauri-apps/api/core').invoke | null = null;

/**
 * Get the Tauri invoke function, loading it dynamically if needed
 */
async function getInvoke(): Promise<typeof import('@tauri-apps/api/core').invoke> {
  if (!invokeFunction) {
    try {
      const tauriCore = await import('@tauri-apps/api/core');
      invokeFunction = tauriCore.invoke;
    } catch (error) {
      console.error('[TauriFetch] Failed to load @tauri-apps/api/core:', error);
      throw new Error('Tauri API not available');
    }
  }
  return invokeFunction;
}

interface ProxyRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Map baleybots proxy paths back to real API URLs
 * Baleybots rewrites URLs like api.anthropic.com/v1/messages to localhost/api/anthropic/chat
 * We need to reverse this since we're making real API calls from Rust
 */
function unmapProxyUrl(url: string): string {
  const originalUrl = url;

  // Check if this is a localhost proxy URL
  if (url.includes('localhost') || url.includes('127.0.0.1')) {
    // Map back to real API endpoints
    if (url.includes('/api/anthropic/chat')) {
      const mapped = 'https://api.anthropic.com/v1/messages';
      console.log('[TauriFetch] URL unmapped:', originalUrl, '→', mapped);
      return mapped;
    }
    if (url.includes('/api/openai/chat')) {
      const mapped = 'https://api.openai.com/v1/chat/completions';
      console.log('[TauriFetch] URL unmapped:', originalUrl, '→', mapped);
      return mapped;
    }
  }

  // No mapping needed
  if (originalUrl !== url) {
    console.log('[TauriFetch] URL unchanged:', originalUrl);
  }
  return url;
}

/**
 * Custom fetch that routes through Tauri's Rust backend
 * Falls back to native fetch when not in Tauri environment
 */
export async function tauriFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  // If not in Tauri, use native fetch
  if (!isTauri()) {
    return fetch(input, init);
  }

  // Build request for Tauri
  let url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  // Reverse baleybots URL rewriting - convert proxy URLs back to real API URLs
  url = unmapProxyUrl(url);

  const method = init?.method || 'GET';

  // Convert headers to plain object
  const headers: Record<string, string> = {};
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(init.headers)) {
      for (const [key, value] of init.headers) {
        headers[key] = value;
      }
    } else {
      Object.assign(headers, init.headers);
    }
  }

  // Get body as string
  let body: string | undefined;
  if (init?.body) {
    if (typeof init.body === 'string') {
      body = init.body;
    } else if (init.body instanceof ArrayBuffer) {
      body = new TextDecoder().decode(init.body);
    } else if (init.body instanceof Blob) {
      body = await init.body.text();
    } else {
      body = String(init.body);
    }
  }

  const request: ProxyRequest = {
    url,
    method,
    headers,
    body,
  };

  try {
    console.log('[TauriFetch] Calling http_proxy:', url, method);
    console.log('[TauriFetch] Headers:', Object.keys(headers).join(', '));

    // Get invoke dynamically to ensure Tauri is ready
    const invoke = await getInvoke();

    // Call Tauri backend
    const response = await invoke<ProxyResponse>('http_proxy', { request });

    console.log('[TauriFetch] Response status:', response.status);

    // Convert to Response object
    const responseHeaders = new Headers();
    for (const [key, value] of Object.entries(response.headers)) {
      responseHeaders.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    // Convert Tauri error to fetch-like error
    console.error('[TauriFetch] Error:', error);
    throw new TypeError(`Network request failed: ${error}`);
  }
}

/**
 * Create a fetch function for use with baleybots
 * Routes through Tauri when available, otherwise uses native fetch
 */
export function createTauriFetch(): typeof fetch {
  return tauriFetch as typeof fetch;
}
