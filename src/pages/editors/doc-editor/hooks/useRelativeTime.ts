import { useState, useEffect } from 'react'

export function useRelativeTime(timestamp: number | null): string | null {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (timestamp === null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [timestamp])

  if (timestamp === null) return null

  const seconds = Math.floor((now - timestamp) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}
