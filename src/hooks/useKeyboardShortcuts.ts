import { useEffect, useCallback } from 'react'

type ShortcutCallback = () => void

interface Shortcut {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  callback: ShortcutCallback
}

export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't trigger shortcuts when user is typing in an input field
      const target = e.target as HTMLElement
      const isTyping = target.tagName === 'INPUT' ||
                       target.tagName === 'TEXTAREA' ||
                       target.isContentEditable
      if (isTyping) return

      for (const shortcut of shortcuts) {
        const metaMatches = shortcut.metaKey ? e.metaKey : !e.metaKey
        const ctrlMatches = shortcut.ctrlKey ? e.ctrlKey : !e.ctrlKey
        const shiftMatches = shortcut.shiftKey ? e.shiftKey : !e.shiftKey

        if (
          e.key.toLowerCase() === shortcut.key.toLowerCase() &&
          metaMatches &&
          ctrlMatches &&
          shiftMatches
        ) {
          e.preventDefault()
          shortcut.callback()
          break
        }
      }
    },
    [shortcuts]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}

// Global shortcuts hook for the app
export function useGlobalShortcuts(callbacks: {
  onNewCapture?: () => void
  onNewSession?: () => void
  onGoHome?: () => void
  onSearch?: () => void
}) {
  useKeyboardShortcuts([
    ...(callbacks.onNewCapture
      ? [{ key: 'n', metaKey: true, callback: callbacks.onNewCapture }]
      : []),
    ...(callbacks.onNewSession
      ? [{ key: 'n', metaKey: true, shiftKey: true, callback: callbacks.onNewSession }]
      : []),
    ...(callbacks.onGoHome
      ? [{ key: 'h', metaKey: true, callback: callbacks.onGoHome }]
      : []),
    ...(callbacks.onSearch
      ? [{ key: 'k', metaKey: true, callback: callbacks.onSearch }]
      : []),
  ])
}
