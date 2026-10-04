import 'server-only'
import { getDatabase } from '@/lib/auth/database'
import { disconnectAllWebRtcReaders, disconnectChannelReaders } from '@/lib/mediamtx'
import { disconnectChatParticipant } from '@/lib/chat-realtime'

const dispatcher = globalThis as typeof globalThis & { accessRevocationRunning?: boolean; accessRevocationTimer?: ReturnType<typeof setInterval> }

/** Revocations survive process restarts and temporary MediaMTX/Centrifugo failures. */
export async function dispatchAccessRevocations(): Promise<void> {
  if (dispatcher.accessRevocationRunning) return
  dispatcher.accessRevocationRunning = true
  try {
    const database = getDatabase()
    const rows = database.prepare(`SELECT id, user_id AS userId, media_path AS mediaPath, chat_done AS chatDone, media_done AS mediaDone FROM access_revocation
      WHERE id IN (SELECT id FROM access_revocation WHERE chat_done = 0 ORDER BY created_at LIMIT 20)
         OR id IN (SELECT id FROM access_revocation WHERE media_done = 0 ORDER BY created_at LIMIT 20)
      ORDER BY created_at`).all() as { id: string; userId: string; mediaPath: string | null; chatDone: number; mediaDone: number }[]
    for (const row of rows) {
      if (!row.chatDone) {
        try {
          await disconnectChatParticipant(row.userId)
          database.prepare('UPDATE access_revocation SET chat_done = 1 WHERE id = ?').run(row.id)
        } catch { /* Retry Chat independently of playback. */ }
      }
      if (!row.mediaDone) {
        try {
          await (row.mediaPath ? disconnectChannelReaders(row.mediaPath) : disconnectAllWebRtcReaders())
          database.prepare('UPDATE access_revocation SET media_done = 1 WHERE id = ?').run(row.id)
        } catch { /* Retry media independently of Chat. */ }
      }
      database.prepare('DELETE FROM access_revocation WHERE id = ? AND chat_done = 1 AND media_done = 1').run(row.id)
    }
  } finally { dispatcher.accessRevocationRunning = false }
}

export function startAccessRevocationDispatcher(): void {
  if (process.env.NEXT_PHASE === 'phase-production-build' || dispatcher.accessRevocationTimer) return
  const dispatch = () => { void dispatchAccessRevocations().catch(() => { /* Database migrations may not have run yet. */ }) }
  dispatcher.accessRevocationTimer = setInterval(dispatch, 5_000)
  dispatcher.accessRevocationTimer.unref()
  dispatch()
}
