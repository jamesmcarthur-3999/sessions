/**
 * ID Generation Utility
 */

/**
 * Generate a unique ID for database records
 * Uses timestamp + random suffix for uniqueness
 */
export function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  return `${timestamp}-${random}`;
}
