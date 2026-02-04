//! HTTP Proxy for AI API calls
//!
//! Forwards HTTP requests from the frontend to external APIs.
//! This bypasses browser CORS restrictions since Rust HTTP clients
//! don't have those limitations.

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;
use tauri::ipc::Channel;

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
    println!("[http_proxy] URL: {}", request.url);
    println!("[http_proxy] Method: {}", request.method);
    println!("[http_proxy] Headers: {:?}", request.headers.keys().collect::<Vec<_>>());

    let client = reqwest::Client::new();

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
        println!("[http_proxy] Body length: {}", body.len());
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

    // Read body
    let body = response.text().await
        .map_err(|e| format!("Failed to read response: {}", e))?;

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
    let client = reqwest::Client::new();

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
