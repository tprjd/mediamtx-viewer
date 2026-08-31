'use client'

import { useEffect, useRef, useState } from 'react'

import {
  isChannelLiveUpdate,
  isChannelStatusSnapshot,
  mergeChannelLiveUpdates,
} from '@/lib/channel-events'
import { mergeChannelsWithLastStatus } from '@/lib/home-dashboard'
import type { ChannelsResponse, PublicChannel } from '@/lib/types'

const STALE_AFTER_MS = 45_000
const FALLBACK_AFTER_MS = 5_000
const FALLBACK_POLL_MS = 30_000

interface ChannelEventsState {
  channels: PublicChannel[]
  statusDelayed: boolean
}

export function useChannelEvents(
  initialChannels: PublicChannel[],
): ChannelEventsState {
  const [channels, setChannels] = useState(initialChannels)
  const [statusDelayed, setStatusDelayed] = useState(false)
  const channelsRef = useRef(channels)

  useEffect(() => {
    let active = true
    let eventSource: EventSource | undefined
    let staleTimer: ReturnType<typeof setTimeout> | undefined
    let fallbackStartTimer: ReturnType<typeof setTimeout> | undefined
    let fallbackPollTimer: ReturnType<typeof setTimeout> | undefined
    let fallbackController: AbortController | undefined
    let fallbackActive = false

    const replaceChannels = (next: PublicChannel[]) => {
      if (!active) return
      channelsRef.current = next
      setChannels(next)
    }

    const applyUpdates = (
      updates: Parameters<typeof mergeChannelLiveUpdates>[1],
    ) => {
      replaceChannels(
        mergeChannelLiveUpdates(channelsRef.current, updates),
      )
    }

    const recordActivity = () => {
      if (!active) return
      setStatusDelayed(false)
      clearTimeout(staleTimer)
      staleTimer = setTimeout(() => {
        if (active) setStatusDelayed(true)
      }, STALE_AFTER_MS)
    }

    const scheduleFallbackPoll = (delay = FALLBACK_POLL_MS) => {
      clearTimeout(fallbackPollTimer)
      if (!active || !fallbackActive) return
      fallbackPollTimer = setTimeout(() => void fallbackPoll(), delay)
    }

    const fallbackPoll = async () => {
      if (!active || !fallbackActive) return
      if (document.hidden) {
        scheduleFallbackPoll()
        return
      }

      fallbackController?.abort()
      fallbackController = new AbortController()
      try {
        const response = await fetch('/api/channels', {
          cache: 'no-store',
          signal: fallbackController.signal,
        })
        if (!response.ok) throw new Error('Channel status request failed')
        const data = (await response.json()) as ChannelsResponse
        const allUnavailable =
          data.channels.length > 0 &&
          data.channels.every(
            (channel) => channel.status.state === 'unavailable',
          )
        if (allUnavailable) {
          replaceChannels(
            mergeChannelsWithLastStatus(channelsRef.current, data.channels),
          )
          setStatusDelayed(true)
        } else {
          replaceChannels(data.channels)
          recordActivity()
        }
      } catch (error) {
        if (
          active &&
          !(error instanceof DOMException && error.name === 'AbortError')
        ) {
          setStatusDelayed(true)
        }
      } finally {
        scheduleFallbackPoll()
      }
    }

    const startFallback = () => {
      if (!active || fallbackActive) return
      fallbackActive = true
      void fallbackPoll()
    }

    const stopFallback = () => {
      fallbackActive = false
      clearTimeout(fallbackStartTimer)
      clearTimeout(fallbackPollTimer)
      fallbackController?.abort()
    }

    const parseEvent = (event: MessageEvent<string>): unknown => {
      try {
        return JSON.parse(event.data) as unknown
      } catch {
        return null
      }
    }

    const connect = () => {
      if (!active || typeof EventSource !== 'function') {
        clearTimeout(fallbackStartTimer)
        fallbackStartTimer = setTimeout(startFallback, FALLBACK_AFTER_MS)
        return
      }

      eventSource?.close()
      const source = new EventSource('/api/channel-events')
      eventSource = source

      source.addEventListener('open', () => stopFallback())
      source.addEventListener('snapshot', (rawEvent) => {
        const data = parseEvent(rawEvent as MessageEvent<string>)
        if (!isChannelStatusSnapshot(data)) return
        applyUpdates(data.channels)
        recordActivity()
      })
      source.addEventListener('channel-status', (rawEvent) => {
        const data = parseEvent(rawEvent as MessageEvent<string>)
        if (!isChannelLiveUpdate(data)) return
        applyUpdates([data])
        recordActivity()
      })
      source.addEventListener('heartbeat', () => recordActivity())
      source.addEventListener('error', () => {
        clearTimeout(fallbackStartTimer)
        fallbackStartTimer = setTimeout(startFallback, FALLBACK_AFTER_MS)
      })
    }

    const handleVisibility = () => {
      if (document.hidden) return
      if (eventSource?.readyState === 2) connect()
      if (fallbackActive) scheduleFallbackPoll(0)
    }

    document.addEventListener('visibilitychange', handleVisibility)
    recordActivity()
    connect()

    return () => {
      active = false
      eventSource?.close()
      stopFallback()
      clearTimeout(staleTimer)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  return { channels, statusDelayed }
}
