import type { Summary, Attachment } from '../types'

/** Validate and safely parse a Summary from unknown data */
export function validateSummary(data: unknown): Summary | null {
  if (!data || typeof data !== 'object') {
    console.warn('[VALIDATE] Summary data is null or not an object')
    return null
  }
  const obj = data as Record<string, unknown>

  return {
    text: typeof obj.text === 'string' ? obj.text : '',
    tasks: Array.isArray(obj.tasks)
      ? obj.tasks.filter((t) => {
          const valid = t && typeof t === 'object' && typeof (t as any).id === 'string'
          if (!valid) console.warn('[VALIDATE] Dropped invalid task:', t)
          return valid
        })
      : [],
    notes: Array.isArray(obj.notes)
      ? obj.notes.filter((n) => {
          const valid = n && typeof n === 'object' && typeof (n as any).id === 'string'
          if (!valid) console.warn('[VALIDATE] Dropped invalid note:', n)
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
    const valid =
      a &&
      typeof a === 'object' &&
      typeof (a as any).id === 'string' &&
      typeof (a as any).name === 'string'
    if (!valid) console.warn('[VALIDATE] Dropped invalid attachment:', a)
    return valid
  }) as Attachment[]
}
