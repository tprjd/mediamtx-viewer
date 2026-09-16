'use client'

import { useEffect, useState } from 'react'

// A deployment can change Chat while this watch page and its player stay open.
export function useChatEnabled(initialEnabled: boolean): boolean {
  const [enabled, setEnabled] = useState(initialEnabled)

  useEffect(() => {
    let stopped = false
    let pending = false
    const controller = new AbortController()
    const check = async () => {
      if (pending) return
      pending = true
      try {
        const response = await fetch('/api/chat/config', {
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)]),
        })
        if (response.status === 401 || response.status === 403) {
          if (!stopped) setEnabled(false)
          return
        }
        if (!response.ok) return
        const result: unknown = await response.json()
        if (!stopped && typeof result === 'object' && result !== null &&
          'enabled' in result && typeof result.enabled === 'boolean') {
          setEnabled(result.enabled)
        }
      } catch {
        // Keep the last flag during a deployment or a temporary network failure.
      } finally {
        pending = false
      }
    }
    const timer = setInterval(() => void check(), 10_000)
    window.addEventListener('focus', check)
    return () => {
      stopped = true
      controller.abort()
      clearInterval(timer)
      window.removeEventListener('focus', check)
    }
  }, [])

  return enabled
}
