import { chatRestoreGeneration } from '@/lib/chat-maintenance'
import { z } from 'zod'
import { getActiveSession } from '@/lib/auth/session'
import { getChatChannel } from '@/lib/channels'
import { isChatEnabled } from '@/lib/chat-environment'
import { clearChatHistory, getChatHistoryState } from '@/lib/chat-history'
import { ChatModerationError, requireChatAdministrator } from '@/lib/chat-moderation'
import { chatModerationFailure, chatModerationHeaders as headers, readChatModerationBody } from '@/lib/chat-moderation-http'
import { dispatchChatOutboxBatch } from '@/lib/chat-outbox'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ slug: string }> }

async function authorize(context: Context) {
  if (!isChatEnabled()) throw new ChatModerationError('Not found.', 404)
  const session = await getActiveSession()
  if (!session) throw new ChatModerationError('An active account is required.', 401)
  requireChatAdministrator(session.user.id)
  const channel = getChatChannel((await context.params).slug)
  if (!channel) throw new ChatModerationError('Channel not found.', 404)
  return { channel, actorId: session.user.id }
}

export async function GET(_request: Request, context: Context) {
  try {
    const { channel } = await authorize(context)
    return Response.json({ ...getChatHistoryState(channel.id), restoreGeneration: chatRestoreGeneration() }, { headers })
  } catch (error) { return chatModerationFailure(error) }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { channel, actorId } = await authorize(context)
    if (!z.object({ confirmed: z.literal(true) }).safeParse(await readChatModerationBody(request)).success) {
      throw new ChatModerationError('Confirm clearing Chat history.', 400)
    }
    clearChatHistory(channel, actorId)
    await dispatchChatOutboxBatch()
    const state = getChatHistoryState(channel.id)
    return Response.json({ ...state, restoreGeneration: chatRestoreGeneration() }, { status: state.clearPending ? 202 : 200, headers })
  } catch (error) { return chatModerationFailure(error) }
}
