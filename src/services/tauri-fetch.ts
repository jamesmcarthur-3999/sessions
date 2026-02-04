/**
 * Tauri Fetch
 *
 * A custom fetch implementation that routes HTTP requests through
 * Tauri's Rust backend, bypassing browser CORS restrictions.
 *
 * This allows baleybots to make direct API calls from a Tauri app
 * without needing a separate proxy server.
 */

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './recording';

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
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
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
    // Call Tauri backend
    const response = await invoke<ProxyResponse>('http_proxy', { request });

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
