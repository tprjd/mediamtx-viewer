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
  onRecoveryFailed: () => void
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
  onRecoveryFailed,
}: UseChatRealtimeInput): 'connected' | 'connecting' | 'disconnected' {
  const [state, setState] = useState<
    'connected' | 'connecting' | 'disconnected'
  >(active ? 'connecting' : 'disconnected')
  const handleMessage = useEffectEvent(onMessage)
  const handleRecoveryFailed = useEffectEvent(onRecoveryFailed)

  useEffect(() => {
    if (!active) return
    const tokenEndpoint = `/api/channels/${encodeURIComponent(channelSlug)}/chat/token`
    const client = new Centrifuge(chatWebSocketUrl(), {
      minReconnectDelay: 250,
      maxReconnectDelay: 3_000,
      timeout: 3_000,
      getToken: async () => {
        const response = await fetch(tokenEndpoint, { cache: 'no-store' })
        const result = (await response.json()) as {
          token?: string
          error?: string
        }
        if (response.status === 401 || response.status === 403) {
          throw new UnauthorizedError(result.error ?? 'Chat access denied.')
        }
        if (!response.ok || !result.token) {
          throw new Error(result.error ?? 'Could not connect to Chat.')
        }
        return result.token
      },
    })
    client.on('publication', (context) => {
      if (!context.channel.startsWith('chat:')) return
      const event = chatMessageEventSchema.safeParse(context.data)
      if (event.success) handleMessage(event.data.message)
    })
    client.on('connected', () => setState('connected'))
    client.on('connecting', () => setState('connecting'))
    client.on('disconnected', () => setState('disconnected'))
    client.on('subscribed', (context) => {
      if (
        context.channel.startsWith('chat:') &&
        context.wasRecovering &&
        !context.recovered
      ) {
        handleRecoveryFailed()
      }
    })
    client.connect()
    return () => client.disconnect()
  }, [active, channelSlug])
  return state
}
