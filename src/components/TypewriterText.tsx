import { useState, useEffect, useRef } from 'react'

interface TypewriterTextProps {
  text: string
  onComplete?: () => void
  speed?: number
}

export function TypewriterText({ text, onComplete, speed = 20 }: TypewriterTextProps) {
  const [displayText, setDisplayText] = useState('')
  const [isComplete, setIsComplete] = useState(false)

  // Use ref for onComplete to avoid dependency issues (stale closure fix)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  useEffect(() => {
    if (isComplete) return

    let index = 0
    const interval = setInterval(() => {
      if (index < text.length) {
        setDisplayText(text.slice(0, index + 1))
        index++
      } else {
        clearInterval(interval)
        setIsComplete(true)
        onCompleteRef.current?.()
      }
    }, speed)

    return () => clearInterval(interval)
  }, [text, speed, isComplete])

  return (
    <span>
      {displayText}
      {!isComplete && <span className="typewriter-cursor" />}
    </span>
  )
}
