import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { getDatabase } from '@/lib/auth/database'
import { authEnvironment } from '@/lib/auth/env'
import { chatEnvironment, isChatEnabled } from '@/lib/chat-environment'
import { isChatRestoring } from '@/lib/chat-maintenance'
import { canWatchChannel } from '@/lib/viewing-access'
import { chatControlChannel, chatTranscriptChannel } from '@/lib/chat-realtime'

const identitySchema = z.object({ accountId: z.string(), channelId: z.string(), sessionId: z.string().min(1) })
const claimsSchema = z.object({ sub: z.string(), sid: z.string().min(1), channels: z.array(z.string()).length(2), aud: z.literal('frankerzspam-chat'), iss: z.literal('frankerzspam-viewer'), exp: z.number() })

function validIdentity(accountId: string, channelId: string, sessionId: string): boolean {
  if (!isChatEnabled() || isChatRestoring()) return false
  const session = getDatabase().prepare('SELECT 1 FROM session WHERE id = ? AND userId = ? AND expiresAt > ?').get(sessionId, accountId, Date.now())
  if (!session) return false
  const channel = getDatabase().prepare('SELECT slug FROM channel WHERE id = ? AND enabled = 1').get(channelId) as { slug: string } | undefined
  return Boolean(channel && canWatchChannel(accountId, channel.slug))
}

export function checkChatConnection(token: string) {
  if (token.length > 4096) return null
  try {
    const [header, payload, signature, extra] = token.split('.')
    if (!header || !payload || !signature || extra) return null
    const expected = createHmac('sha256', chatEnvironment.centrifugoTokenHmacSecret).update(`${header}.${payload}`).digest()
    const supplied = Buffer.from(signature, 'base64url')
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null
    const claims = claimsSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString()))
    const channelId = claims.channels[0].startsWith('chat:') ? claims.channels[0].slice(5) : ''
    if (claims.exp <= Date.now() / 1000 || claims.channels[1] !== chatControlChannel(claims.sub) || !validIdentity(claims.sub, channelId, claims.sid)) return null
    return { user: claims.sub, channels: [chatTranscriptChannel(channelId), chatControlChannel(claims.sub)], expire_at: Math.floor(Date.now() / 1000) + 30, meta: { accountId: claims.sub, channelId, sessionId: claims.sid } }
  } catch { return null }
}

export function refreshChatConnection(meta: unknown) {
  const identity = identitySchema.safeParse(meta)
  if (!identity.success || !validIdentity(identity.data.accountId, identity.data.channelId, identity.data.sessionId)) return { expired: true }
  return { expire_at: Math.floor(Date.now() / 1000) + 30 }
}

export function trustedChatProxy(request: Request): boolean {
  const supplied = Buffer.from(request.headers.get('x-internal-auth') ?? '')
  const expected = Buffer.from(authEnvironment.internalSecret)
  return expected.length > 0 && expected.length === supplied.length && timingSafeEqual(supplied, expected)
}
