/**
 * Error utility - extracts a human-readable message from unknown error values.
 */

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
