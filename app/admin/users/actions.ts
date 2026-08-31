'use server'

import { redirect } from 'next/navigation'

import { requireAdminSession } from '@/lib/auth/session'
import {
  activateUser,
  clearAuditEntries,
  createPasswordResetToken,
  disableUser,
  rejectPendingUser,
  revokeSession,
  revokeUserSessions,
  setRegistrationOpen,
} from '@/lib/auth/store'
import { grantStreaming, setChannelEnabled } from '@/lib/channels'
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
  redirect(destination('notice', 'Account activated.'))
}

export async function disableAction(userId: string) {
  let disconnectWarning = false
  await runAdminAction(async (actorId) => {
    const mediaPath = disableUser(actorId, userId)
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

export async function rejectAction(userId: string) {
  await runAdminAction((actorId) => rejectPendingUser(actorId, userId))
  redirect(destination('notice', 'Registration rejected.'))
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

export async function registrationAction(formData: FormData) {
  const open = formData.get('open') === 'true'
  await runAdminAction((actorId) => setRegistrationOpen(actorId, open))
  redirect(destination('notice', open ? 'Registration opened.' : 'Registration closed.'))
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
