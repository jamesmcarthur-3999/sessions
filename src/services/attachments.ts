import type { Attachment } from '../types'
import { generateId } from '../utils/id'
import { isTauri } from './recording'

function toAttachmentType(mimeType: string): Attachment['type'] {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.startsWith('video/')) return 'video'
  return 'file'
}

function sanitizeFileName(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9._-]/g, '_')
  return sanitized.length > 0 ? sanitized : 'attachment'
}

/** Minimal FS interface matching Tauri plugin-fs APIs across versions */
interface TauriFs {
  createDir?: (path: string, opts?: { recursive?: boolean }) => Promise<void>
  mkdir?: (path: string, opts?: { recursive?: boolean }) => Promise<void>
  createDirectory?: (path: string, opts?: { recursive?: boolean }) => Promise<void>
  writeFile?: (...args: unknown[]) => Promise<void>
  writeBinaryFile?: (...args: unknown[]) => Promise<void>
  writeTextFile?: (...args: unknown[]) => Promise<void>
}

async function ensureDir(fs: TauriFs, dir: string): Promise<void> {
  const createDir = fs.createDir || fs.mkdir || fs.createDirectory
  if (!createDir) {
    throw new Error('No directory creation API available')
  }
  try {
    await createDir(dir, { recursive: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.toLowerCase().includes('exists')) {
      throw error
    }
  }
}

async function writeFileFlexible(fs: TauriFs, path: string, bytes: Uint8Array): Promise<void> {
  const writeFile = fs.writeFile || fs.writeBinaryFile || fs.writeTextFile
  if (!writeFile) {
    throw new Error('No file write API available')
  }

  try {
    await writeFile(path, bytes)
    return
  } catch {
    // Try alternate signature
  }

  await writeFile({ path, contents: bytes })
}

export async function persistCaptureAttachments(
  sessionId: string,
  files: File[]
): Promise<Attachment[]> {
  if (files.length === 0) return []

  if (!isTauri()) {
    return files.map((file) => ({
      id: generateId(),
      type: toAttachmentType(file.type || ''),
      name: file.name,
      path: '',
      mimeType: file.type,
      size: file.size,
    }))
  }

  const { appDataDir, join } = await import('@tauri-apps/api/path')
  const fs = await import('@tauri-apps/plugin-fs') as unknown as TauriFs

  const root = await appDataDir()
  const attachmentsDir = await join(root, 'attachments', sessionId)
  await ensureDir(fs, attachmentsDir)

  const saved: Attachment[] = []

  for (const file of files) {
    const safeName = sanitizeFileName(file.name)
    const fileId = generateId()
    const targetPath = await join(attachmentsDir, `${fileId}_${safeName}`)
    const buffer = await file.arrayBuffer()
    await writeFileFlexible(fs, targetPath, new Uint8Array(buffer))

    saved.push({
      id: fileId,
      type: toAttachmentType(file.type || ''),
      name: file.name,
      path: targetPath,
      mimeType: file.type,
      size: file.size,
    })
  }

  return saved
}
