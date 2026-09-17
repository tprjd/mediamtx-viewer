'use client'

import { Centrifuge, UnauthorizedError } from 'centrifuge'
import { useEffect, useEffectEvent, useState } from 'react'
import { z } from 'zod'

import type { PublicChatMessage } from '@/lib/chat-types'

const chatMessageEventSchema = z.object({
  type: z.literal('message'),
  eventId: z.string(),
  message: z.union([
    z.object({
      id: z.string(),
      submissionId: z.string().optional(),
      sequence: z.number().int().positive(),
      content: z.string(),
      profileName: z.string(),
      authorTag: z.string(),
      badges: z.array(z.enum(['admin', 'owner'])),
      serverTimestamp: z.string(),
    }),
    z.object({
      id: z.string(),
      sequence: z.number().int().positive(),
      revisionSequence: z.number().int().positive(),
      serverTimestamp: z.string(),
      removed: z.literal(true),
    }),
  ]),
})

interface UseChatRealtimeInput {
  active: boolean
  channelSlug: string
  onMessage: (message: PublicChatMessage) => void
  onHistoryCleared: (clearedThrough: number, restoreGeneration?: string) => void
  onRecoveryFailed: () => void
  onRestored: () => void
  onRestrictionChanged: (channelId?: string) => void
}

function chatWebSocketUrl(): string {
  const configured = process.env.NEXT_PUBLIC_CENTRIFUGO_WEBSOCKET_URL
  if (configured) return configured
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/chat/realtime/connection/websocket`
}

export function useChatRealtime({
  active,
  channelSlug,
  onMessage,
  onHistoryCleared,
  onRecoveryFailed,
  onRestored,
  onRestrictionChanged,
}: UseChatRealtimeInput): 'connected' | 'connecting' | 'disconnected' {
  const [state, setState] = useState<
    'connected' | 'connecting' | 'disconnected'
  >(active ? 'connecting' : 'disconnected')
  const handleMessage = useEffectEvent(onMessage)
  const handleHistoryCleared = useEffectEvent(onHistoryCleared)
  const handleRestored = useEffectEvent(onRestored)
  const handleRecoveryFailed = useEffectEvent(onRecoveryFailed)
  const handleRestrictionChanged = useEffectEvent(onRestrictionChanged)

  useEffect(() => {
    if (!active) return
    let disposed = false
    const tokenEndpoint = `/api/channels/${encodeURIComponent(channelSlug)}/chat/token`
    const client = new Centrifuge(chatWebSocketUrl(), {
      minReconnectDelay: 250,
      maxReconnectDelay: 3_000,
      timeout: 3_000,
      getToken: async () => {
        const response = await fetch(tokenEndpoint, { cache: 'no-store' })
        const result = (await response.json()) as {
          token?: string
          restoreGeneration?: string
          clearedThrough?: number
          clearPending?: boolean
          error?: string
        }
        if (disposed) return ''
        if (response.status === 401 || response.status === 403) {
          throw new UnauthorizedError(result.error ?? 'Chat access denied.')
        }
        if (!response.ok || !result.token) {
          throw new Error(result.error ?? 'Could not connect to Chat.')
        }
        if (Number.isSafeInteger(result.clearedThrough) && result.clearedThrough! >= 0) {
          handleHistoryCleared(result.clearedThrough!, result.restoreGeneration)
        }
        if (result.clearPending) throw new Error('Chat history is being cleared.')
        return result.token
      },
    })
    client.on('publication', (context) => {
      if (disposed) return
      if (context.channel.startsWith('control:')) {
        const event = z
          .object({ type: z.literal('restriction'), channelId: z.string() })
          .safeParse(context.data)
        if (event.success) handleRestrictionChanged(event.data.channelId)
        return
      }
      if (!context.channel.startsWith('chat:')) return
      const cleared = z.object({
        restoreGeneration: z.string().optional(),
        type: z.literal('history-cleared'), clearedThrough: z.number().int().nonnegative(),
      }).safeParse(context.data)
      if (cleared.success) {
        handleHistoryCleared(cleared.data.clearedThrough, cleared.data.restoreGeneration)
        return
      }
      const event = chatMessageEventSchema.safeParse(context.data)
      if (event.success) handleMessage(event.data.message)
    })
    let restored = false
    client.on('connected', () => {
      setState('connected')
      if (restored) {
        restored = false
        handleRestored()
      }
    })
    client.on('connecting', (context) => {
      if (context.code === 4001) {
        restored = true
        // A fresh token is unavailable until restore validation and cleanup finish.
        client.setToken('')
      }
      setState('connecting')
    })
    client.on('disconnected', () => setState('disconnected'))
    client.on('subscribed', (context) => {
      // Control channels have no recovery history. Read current state after each subscription.
      if (context.channel.startsWith('control:')) handleRestrictionChanged()
      if (
        context.channel.startsWith('chat:') &&
        context.wasRecovering &&
        !context.recovered
      ) {
        handleRecoveryFailed()
      }
    })
    client.connect()
    return () => { disposed = true; client.disconnect() }
  }, [active, channelSlug])
  return state
}
