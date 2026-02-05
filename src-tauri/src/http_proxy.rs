//! HTTP Proxy for AI API calls
//!
//! Forwards HTTP requests from the frontend to external APIs.
//! This bypasses browser CORS restrictions since Rust HTTP clients
//! don't have those limitations.

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;
use std::time::Duration;
use tauri::ipc::Channel;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_RESPONSE_BYTES: usize = 50 * 1024 * 1024; // 50MB

fn create_proxy_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))
}

/// Allowed destination hosts for the HTTP proxy.
/// Only HTTPS requests to these domains are permitted.
const ALLOWED_HOSTS: &[&str] = &[
    "api.anthropic.com",
    "api.openai.com",
];

/// Validate that a proxy URL is allowed (HTTPS only, whitelisted host).
fn validate_proxy_url(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url)
        .map_err(|e| format!("Invalid URL: {}", e))?;

    if parsed.scheme() != "https" {
        return Err(format!("Only HTTPS URLs allowed, got: {}", parsed.scheme()));
    }

    let host = parsed.host_str()
        .ok_or_else(|| "URL has no host".to_string())?;

    if !ALLOWED_HOSTS.iter().any(|allowed| host == *allowed) {
        return Err(format!("Host not allowed: {}. Allowed: {:?}", host, ALLOWED_HOSTS));
    }

    Ok(())
}

/// Request payload from frontend
#[derive(Debug, Deserialize)]
pub struct ProxyRequest {
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
}

/// Response payload to frontend
#[derive(Debug, Serialize, Clone)]
pub struct ProxyResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// Streaming chunk sent via channel
#[derive(Debug, Serialize, Clone)]
pub struct StreamChunk {
    pub chunk: String,
    pub done: bool,
}

/// Make an HTTP request and return the full response
#[tauri::command]
pub async fn http_proxy(request: ProxyRequest) -> Result<ProxyResponse, String> {
    validate_proxy_url(&request.url)?;
    println!("[http_proxy] {} {}", request.method, request.url);

    let client = create_proxy_client()?;

    // Build headers
    let mut headers = HeaderMap::new();
    for (key, value) in &request.headers {
        if let (Ok(name), Ok(val)) = (
            HeaderName::from_str(key),
            HeaderValue::from_str(value),
        ) {
            headers.insert(name, val);
        }
    }

    // Build request
    let method = reqwest::Method::from_str(&request.method.to_uppercase())
        .map_err(|e| format!("Invalid method: {}", e))?;

    let mut req = client.request(method, &request.url).headers(headers);

    if let Some(ref body) = request.body {
        req = req.body(body.clone());
    }

    // Send request
    let response = req.send().await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status().as_u16();
    println!("[http_proxy] Response status: {}", status);

    // Collect response headers
    let mut resp_headers = HashMap::new();
    for (key, value) in response.headers() {
        if let Ok(v) = value.to_str() {
            resp_headers.insert(key.to_string(), v.to_string());
        }
    }

    // Read body with size limit
    let body_bytes = response.bytes().await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    if body_bytes.len() > MAX_RESPONSE_BYTES {
        return Err(format!("Response too large: {} bytes (max {})", body_bytes.len(), MAX_RESPONSE_BYTES));
    }

    let body = String::from_utf8_lossy(&body_bytes).into_owned();

    // Log error responses for debugging
    if status >= 400 {
        println!("[http_proxy] Error response body: {}", &body[..body.len().min(500)]);
    }

    Ok(ProxyResponse {
        status,
        headers: resp_headers,
        body,
    })
}

/// Make a streaming HTTP request and send chunks via channel
#[tauri::command]
pub async fn http_proxy_stream(
    request: ProxyRequest,
    on_chunk: Channel<StreamChunk>,
) -> Result<(), String> {
    validate_proxy_url(&request.url)?;
    let client = create_proxy_client()?;

    // Build headers
    let mut headers = HeaderMap::new();
    for (key, value) in &request.headers {
        if let (Ok(name), Ok(val)) = (
            HeaderName::from_str(key),
            HeaderValue::from_str(value),
        ) {
            headers.insert(name, val);
        }
    }

    // Build request
    let method = reqwest::Method::from_str(&request.method.to_uppercase())
        .map_err(|e| format!("Invalid method: {}", e))?;

    let mut req = client.request(method, &request.url).headers(headers);

    if let Some(body) = request.body {
        req = req.body(body);
    }

    // Send request
    let response = req.send().await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status, body));
    }

    // Stream the response
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();

    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(bytes) => {
                if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                    on_chunk.send(StreamChunk {
                        chunk: text,
                        done: false,
                    }).map_err(|e| format!("Failed to send chunk: {}", e))?;
                }
            }
            Err(e) => {
                return Err(format!("Stream error: {}", e));
            }
        }
    }

    // Send done signal
    on_chunk.send(StreamChunk {
        chunk: String::new(),
        done: true,
    }).map_err(|e| format!("Failed to send done signal: {}", e))?;

    Ok(())
}
