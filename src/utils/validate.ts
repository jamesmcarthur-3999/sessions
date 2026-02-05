import type { Summary, Attachment } from '../types'

/** Validate and safely parse a Summary from unknown data */
export function validateSummary(data: unknown): Summary | null {
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>

  return {
    text: typeof obj.text === 'string' ? obj.text : '',
    tasks: Array.isArray(obj.tasks)
      ? obj.tasks.filter(
          (t) => t && typeof t === 'object' && typeof (t as any).id === 'string'
        )
      : [],
    notes: Array.isArray(obj.notes)
      ? obj.notes.filter(
          (n) => n && typeof n === 'object' && typeof (n as any).id === 'string'
        )
      : [],
    generatedAt:
      typeof obj.generatedAt === 'string' ? obj.generatedAt : new Date().toISOString(),
  }
}

/** Validate and safely parse an Attachment array from unknown data */
export function validateAttachments(data: unknown): Attachment[] {
  if (!Array.isArray(data)) return []
  return data.filter(
    (a) =>
      a &&
      typeof a === 'object' &&
      typeof (a as any).id === 'string' &&
      typeof (a as any).name === 'string'
  ) as Attachment[]
}
