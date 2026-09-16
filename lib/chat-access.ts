import 'server-only'

import { assertChatAvailable, isChatRestoring } from '@/lib/chat-maintenance'
import { getActiveSession } from '@/lib/auth/session'
import { getUserById } from '@/lib/auth/store'
import { getChatChannel, type ChatChannel } from '@/lib/channels'
import {
  getChatRuntimeConfigurationErrors,
  isChatEnabled,
} from '@/lib/chat-environment'
import { getChannelStatus } from '@/lib/mediamtx'

export type LiveChatAccess =
  | {
      ok: true
      channel: ChatChannel
      accountId: string
      profileName: string
    }
  | { ok: false; status: number; error: string }

export async function authorizeLiveChat(slug: string): Promise<LiveChatAccess> {
  if (!isChatEnabled()) {
    return { ok: false, status: 404, error: 'Not found' }
  }
  if (isChatRestoring() || getChatRuntimeConfigurationErrors().length > 0) {
    return { ok: false, status: 503, error: 'Chat is unavailable.' }
  }

  try {
    assertChatAvailable()
  } catch {
    return { ok: false, status: 503, error: 'Chat is unavailable.' }
  }
  const session = await getActiveSession()
  if (!session) {
    return {
      ok: false,
      status: 401,
      error: 'An active account is required.',
    }
  }
  const account = getUserById(session.user.id)
  if (!account || account.activationStatus !== 'active') {
    return {
      ok: false,
      status: 401,
      error: 'An active account is required.',
    }
  }
  const channel = getChatChannel(slug)
  if (!channel) {
    return { ok: false, status: 404, error: 'Channel not found.' }
  }
  const status = await getChannelStatus(channel.mediaPath)
  if (!status.live) {
    return {
      ok: false,
      status: 409,
      error: 'Chat is available only while the Channel is live.',
    }
  }
  const currentAccount = getUserById(session.user.id)
  if (!currentAccount || currentAccount.activationStatus !== 'active') {
    return {
      ok: false,
      status: 401,
      error: 'An active account is required.',
    }
  }
  if (isChatRestoring())
    return { ok: false, status: 503, error: 'Chat is unavailable.' }
  return {
    ok: true,
    channel,
    accountId: currentAccount.id,
    profileName: currentAccount.name,
  }
}
