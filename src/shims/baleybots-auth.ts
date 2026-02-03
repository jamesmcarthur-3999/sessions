// Browser shim for @baleybots/auth (Node.js-only package)
// This shim provides no-op implementations that won't break imports
// The actual auth functionality only runs in Tauri context

export const OAUTH_BETA_HEADER = 'oauth-2025-04-20'
export const CLAUDE_CODE_USER_AGENT = 'claude-code/1.0.0'

export function getRequestHeaders(credential: string): Record<string, string> {
  console.warn('@baleybots/auth: getRequestHeaders called in browser context')
  return {
    'Content-Type': 'application/json',
    'x-api-key': credential,
    'anthropic-version': '2023-06-01'
  }
}

export function getAuthHeaders(credential: string): Record<string, string> {
  console.warn('@baleybots/auth: getAuthHeaders called in browser context')
  return {
    'x-api-key': credential,
    'anthropic-version': '2023-06-01'
  }
}

export function isOAuthToken(_token: string): boolean {
  return false
}

export function isTokenExpired(_expiresAt: number, _bufferSeconds?: number): boolean {
  return true
}

export function getTokenTimeRemaining(_expiresAt: number) {
  return { seconds: 0, minutes: 0, hours: 0, isExpired: true }
}

export async function getValidToken(auth: unknown): Promise<unknown> {
  return auth
}

export async function authenticate(): Promise<unknown> {
  throw new Error('@baleybots/auth: authenticate not available in browser')
}

export async function refreshToken(_refreshToken: string): Promise<unknown> {
  throw new Error('@baleybots/auth: refreshToken not available in browser')
}

export async function createAuthenticatedSession(_storageFilePath?: string): Promise<unknown> {
  throw new Error('@baleybots/auth: createAuthenticatedSession not available in browser')
}

export function createClient(_initialAuth: unknown, _options?: unknown): unknown {
  throw new Error('@baleybots/auth: createClient not available in browser')
}

export class TokenManager {
  constructor(_storageFilePath?: string) {
    console.warn('@baleybots/auth: TokenManager instantiated in browser context')
  }
  async isAuthenticated(): Promise<boolean> { return false }
  async authenticate(): Promise<void> { throw new Error('Not available in browser') }
  async getValidAccessToken(): Promise<string> { throw new Error('Not available in browser') }
}

export class AnthropicOAuthClient {
  constructor(_config?: unknown) {
    console.warn('@baleybots/auth: AnthropicOAuthClient instantiated in browser context')
  }
  async authenticate(): Promise<unknown> { throw new Error('Not available in browser') }
  async refreshTokens(_refreshToken: string): Promise<unknown> { throw new Error('Not available in browser') }
}

export class TokenStorage {
  constructor(_filePath?: string) {
    console.warn('@baleybots/auth: TokenStorage instantiated in browser context')
  }
  async load(): Promise<unknown> { return null }
  async save(_tokens: unknown): Promise<void> {}
  async clear(): Promise<void> {}
}

export class CallbackServer {
  constructor(_port?: number) {
    console.warn('@baleybots/auth: CallbackServer instantiated in browser context')
  }
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

// PKCE exports
export function generateCodeVerifier(): string { return '' }
export function generateCodeChallenge(_verifier: string): string { return '' }
export function generateState(): string { return '' }
