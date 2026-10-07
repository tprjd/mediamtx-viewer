import 'server-only'

import { disableUser } from '@/lib/auth/store'
import { setChannelEnabled } from '@/lib/channels'
import { disconnectChatParticipant } from '@/lib/chat-realtime'
import { disconnectChannelSessions } from '@/lib/mediamtx'

type DisconnectionResult = 'completed' | 'unconfirmed' | 'not-required'

interface AccountSuspensionResult {
  chat: Exclude<DisconnectionResult, 'not-required'>
  media: DisconnectionResult
}

async function completeChannelDisconnection(mediaPath: string | null): Promise<DisconnectionResult> {
  if (mediaPath === null) return 'not-required'
  try {
    await disconnectChannelSessions(mediaPath)
    return 'completed'
  } catch {
    return 'unconfirmed'
  }
}

/** Call after administrator authorization. Stored restrictions commit before network work. */
export async function suspendAccount(actorId: string, accountId: string): Promise<AccountSuspensionResult> {
  const mediaPath = disableUser(actorId, accountId)
  let chat: AccountSuspensionResult['chat'] = 'completed'
  try {
    await disconnectChatParticipant(accountId)
  } catch {
    chat = 'unconfirmed'
  }
  // A Chat failure must not prevent the owned Channel's disconnection attempt.
  // The stored revocation remains for the separate account-wide reader dispatcher.
  const media = await completeChannelDisconnection(mediaPath)
  return { chat, media }
}

/** Enabling a Channel neither disconnects sessions nor creates a replacement key. */
export async function setAccountChannelEnabled(
  actorId: string,
  accountId: string,
  enabled: boolean,
): Promise<{ media: DisconnectionResult }> {
  const mediaPath = setChannelEnabled(actorId, accountId, enabled)
  return { media: await completeChannelDisconnection(enabled ? null : mediaPath) }
}
