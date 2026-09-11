import 'server-only'

import { createHmac, randomUUID } from 'node:crypto'

import { chatEnvironment, isChatEnabled } from '@/lib/chat-environment'

const CHAT_TOKEN_AUDIENCE = 'frankerzspam-chat'
const CHAT_TOKEN_ISSUER = 'frankerzspam-viewer'
const CHAT_TOKEN_LIFETIME_SECONDS = 5 * 60

interface CreateChatConnectionTokenInput {
  accountId: string
  channelId: string
  now?: Date
  secret?: string
}

interface CentrifugoApiResponse {
  error?: { code?: number; message?: string }
  result?: unknown
}

export function chatTranscriptChannel(channelId: string): string {
  return `chat:${channelId}`
}

export function chatControlChannel(accountId: string): string {
  return `control:#${accountId}`
}

function encodeJwtPart(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function createChatConnectionToken({
  accountId,
  channelId,
  now = new Date(),
  secret = chatEnvironment.centrifugoTokenHmacSecret,
}: CreateChatConnectionTokenInput): string {
  const issuedAt = Math.floor(now.getTime() / 1000)
  const header = encodeJwtPart({ alg: 'HS256', typ: 'JWT' })
  const payload = encodeJwtPart({
    aud: CHAT_TOKEN_AUDIENCE,
    channels: [
      chatTranscriptChannel(channelId),
      chatControlChannel(accountId),
    ],
    exp: issuedAt + CHAT_TOKEN_LIFETIME_SECONDS,
    iat: issuedAt,
    iss: CHAT_TOKEN_ISSUER,
    sub: accountId,
  })
  const unsignedToken = `${header}.${payload}`
  const signature = createHmac('sha256', secret)
    .update(unsignedToken)
    .digest('base64url')
  return `${unsignedToken}.${signature}`
}

async function callCentrifugoApi(
  method: 'disconnect' | 'publish',
  body: Record<string, unknown>,
  fetcher: typeof fetch,
): Promise<void> {
  const response = await fetcher(`${chatEnvironment.centrifugoApiUrl}/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': chatEnvironment.centrifugoApiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(3_000),
  })
  const result = (await response.json().catch(() => ({}))) as CentrifugoApiResponse
  if (!response.ok || result.error) {
    throw new Error(`Centrifugo ${method} failed`)
  }
}

export async function publishChatEvent(
  channel: string,
  data: unknown,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await callCentrifugoApi(
    'publish',
    {
      channel,
      data,
      idempotency_key: idempotencyKey,
    },
    fetcher,
  )
}

export async function disconnectChatParticipant(
  accountId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!isChatEnabled()) return
  await callCentrifugoApi(
    'disconnect',
    {
      user: accountId,
      disconnect: {
        code: 3500,
        reason: 'account disabled',
      },
    },
    fetcher,
  )
}

export function createChatPublicationId(): string {
  return randomUUID()
}
