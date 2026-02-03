// Browser shim for open (Node.js-only package)
// In browser, we can use window.open instead
export default async function open(target: string, _options?: unknown): Promise<unknown> {
  if (typeof window !== 'undefined') {
    window.open(target, '_blank')
  }
  return undefined
}
