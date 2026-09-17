import { getChatDatabase } from '@/lib/chat-database'
import { chatRestoreGeneration } from '@/lib/chat-maintenance'
import { getChatHistoryState } from '@/lib/chat-history'
import { inspectChatStorage } from '@/lib/chat-storage'
import { authorizeLiveChat } from '@/lib/chat-access'
import { getChatParticipantState } from '@/lib/chat-moderation'

export const dynamic = 'force-dynamic'
const headers = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await context.params
    const access = await authorizeLiveChat(slug)
    if (!access.ok)
      return Response.json(
        { error: access.error },
        { status: access.status, headers },
      )
    const database = getChatDatabase()
    const state = database
      .transaction(() => {
        const storage = inspectChatStorage(database)
        return {
          ...getChatParticipantState(access.channel, access.accountId),
          ...getChatHistoryState(access.channel.id),
          restoreGeneration: chatRestoreGeneration(),
          storageLimited:
            storage.databaseLimitReached || storage.diskLimitReached,
        }
      })
      .immediate()
    return Response.json(state, { headers })
  } catch {
    return Response.json(
      { error: 'Chat is unavailable.' },
      { status: 503, headers },
    )
  }
}
