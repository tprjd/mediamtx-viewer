'use server'

import { setAdministratorApproval } from '@/lib/viewing-requests'
import { dispatchAccessRevocations } from '@/lib/access-revocations'
import { redirect } from 'next/navigation'

import { requireAdminSession } from '@/lib/auth/session'
import {
  activateUser,
  clearAuditEntries,
  createPasswordResetToken,
  disableUser,
  revokeSession,
  revokeUserSessions,
} from '@/lib/auth/store'
import { grantStreaming, setChannelEnabled } from '@/lib/channels'
import { disconnectChatParticipant } from '@/lib/chat-realtime'
import { disconnectChannelSessions } from '@/lib/mediamtx'

function destination(kind: 'notice' | 'error', message: string): string {
  return `/admin/users?${kind}=${encodeURIComponent(message)}`
}

async function runAdminAction(action: (actorId: string) => void | Promise<void>) {
  const session = await requireAdminSession()
  try {
    await action(session.user.id)
  } catch (error) {
    redirect(
      destination(
        'error',
        error instanceof Error ? error.message : 'The action could not be completed.',
      ),
    )
  }
}

export async function activateAction(userId: string) {
  await runAdminAction((actorId) => activateUser(actorId, userId))
  redirect(destination('notice', 'Account restored. Viewing approval is unchanged.'))
}

export async function disableAction(userId: string) {
  let disconnectWarning = false
  let chatDisconnectWarning = false
  await runAdminAction(async (actorId) => {
    const mediaPath = disableUser(actorId, userId)
    try {
      await disconnectChatParticipant(userId)
    } catch {
      chatDisconnectWarning = true
    }
    if (mediaPath) {
      try {
        await disconnectChannelSessions(mediaPath)
      } catch {
        disconnectWarning = true
      }
    }
  })
  redirect(
    destination(
      'notice',
      disconnectWarning
        ? 'Account disabled and credentials revoked. MediaMTX could not confirm active stream disconnection.'
        : chatDisconnectWarning
          ? 'Account disabled and sessions revoked. Centrifugo could not confirm Chat disconnection.'
        : 'Account disabled and sessions revoked.',
    ),
  )
}

export async function grantStreamingAction(userId: string, formData: FormData) {
  await runAdminAction((actorId) => {
    grantStreaming(actorId, userId, String(formData.get('slug') ?? ''))
  })
  redirect(destination('notice', 'Streaming access granted.'))
}

export async function channelEnabledAction(userId: string, formData: FormData) {
  const enabled = formData.get('enabled') === 'true'
  let disconnectWarning = false
  await runAdminAction(async (actorId) => {
    const mediaPath = setChannelEnabled(actorId, userId, enabled)
    if (!enabled) {
      try {
        await disconnectChannelSessions(mediaPath)
      } catch {
        disconnectWarning = true
      }
    }
  })
  redirect(
    destination(
      'notice',
      enabled
        ? 'Channel enabled. The streamer must generate a new key.'
        : disconnectWarning
          ? 'Channel disabled and key revoked. MediaMTX could not confirm active session disconnection.'
          : 'Channel disabled, key revoked, and sessions disconnected.',
    ),
  )
}

export async function revokeAllSessionsAction(userId: string) {
  await runAdminAction((actorId) => {
    revokeUserSessions(actorId, userId)
  })
  redirect(destination('notice', 'Sessions revoked.'))
}

export async function revokeSessionAction(sessionId: string) {
  await runAdminAction((actorId) => revokeSession(actorId, sessionId))
  redirect(destination('notice', 'Session revoked.'))
}

export async function resetLinkAction(userId: string) {
  let token = ''
  await runAdminAction((actorId) => {
    token = createPasswordResetToken(actorId, userId)
  })
  redirect(`/admin/users?reset=${encodeURIComponent(token)}`)
}

export async function clearActivityAction() {
  let clearedEntries = 0
  await runAdminAction(() => {
    clearedEntries = clearAuditEntries()
  })
  redirect(
    destination(
      'notice',
      clearedEntries === 1
        ? 'Cleared 1 activity entry.'
        : `Cleared ${clearedEntries} activity entries.`,
    ),
  )
}

export async function administratorApprovalAction(userId: string, form: FormData) {
  const approved = form.get('approved') === 'true'
  await runAdminAction(async (actorId) => {
    setAdministratorApproval(actorId, userId, approved)
    await dispatchAccessRevocations()
  })
  redirect(destination('notice', approved ? 'All-channel viewing approved.' : 'Global viewing approval removed. Stored channel approvals remain.'))
}
