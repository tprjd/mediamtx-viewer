'use client'

import { useEffect, useState } from 'react'

import type { ChannelStatus } from '@/lib/types'

const LIVE_POLL_MS = 5_000
const OFFLINE_POLL_MS = 3_000
const MAX_RETRY_MS = 30_000

interface StatusResponse {
  status: ChannelStatus
}

export function useChannelStatus(
  slug: string,
  initialStatus: ChannelStatus,
): ChannelStatus {
  const [status, setStatus] = useState(initialStatus)

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | undefined
    let failures = 0

    const schedule = (delay: number) => {
      if (!active) return
      clearTimeout(timer)
      timer = setTimeout(poll, delay)
    }

    const poll = async () => {
      if (!active) return
      if (document.hidden) {
        schedule(LIVE_POLL_MS)
        return
      }

      controller?.abort()
      controller = new AbortController()

      try {
        const response = await fetch(
          `/api/channels/${encodeURIComponent(slug)}/status`,
          {
            cache: 'no-store',
            signal: controller.signal,
          },
        )

        if (!response.ok) {
          throw new Error(`Status request failed: ${response.status}`)
        }

        const body = (await response.json()) as StatusResponse
        if (!active) return

        failures = 0
        setStatus(body.status)
        schedule(body.status.live ? LIVE_POLL_MS : OFFLINE_POLL_MS)
      } catch (error) {
        if (!active || (error instanceof DOMException && error.name === 'AbortError')) {
          return
        }

        failures += 1
        const retryDelay = Math.min(
          OFFLINE_POLL_MS * 2 ** Math.min(failures - 1, 4),
          MAX_RETRY_MS,
        )
        schedule(retryDelay)
      }
    }

    const handleVisibility = () => {
      if (!document.hidden) {
        clearTimeout(timer)
        void poll()
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    schedule(initialStatus.live ? LIVE_POLL_MS : OFFLINE_POLL_MS)

    return () => {
      active = false
      clearTimeout(timer)
      controller?.abort()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [initialStatus.live, slug])

  return status
}
