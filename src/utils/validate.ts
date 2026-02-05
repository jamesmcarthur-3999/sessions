import type { Summary, Attachment } from '../types'
import { logger } from './logger'

function hasStringProp(obj: unknown, prop: string): boolean {
  return !!obj && typeof obj === 'object' && typeof (obj as Record<string, unknown>)[prop] === 'string'
}

/** Validate and safely parse a Summary from unknown data */
export function validateSummary(data: unknown): Summary | null {
  if (!data || typeof data !== 'object') {
    logger.warn('[VALIDATE] Summary data is null or not an object')
    return null
  }
  const obj = data as Record<string, unknown>

  return {
    text: typeof obj.text === 'string' ? obj.text : '',
    tasks: Array.isArray(obj.tasks)
      ? obj.tasks.filter((t) => {
          const valid = hasStringProp(t, 'id')
          if (!valid) logger.warn('[VALIDATE] Dropped invalid task:', t)
          return valid
        })
      : [],
    notes: Array.isArray(obj.notes)
      ? obj.notes.filter((n) => {
          const valid = hasStringProp(n, 'id')
          if (!valid) logger.warn('[VALIDATE] Dropped invalid note:', n)
          return valid
        })
      : [],
    generatedAt:
      typeof obj.generatedAt === 'string' ? obj.generatedAt : new Date().toISOString(),
  }
}

/** Validate and safely parse an Attachment array from unknown data */
export function validateAttachments(data: unknown): Attachment[] {
  if (!Array.isArray(data)) return []
  return data.filter((a) => {
    const valid = hasStringProp(a, 'id') && hasStringProp(a, 'name')
    if (!valid) logger.warn('[VALIDATE] Dropped invalid attachment:', a)
    return valid
  }) as Attachment[]
}
