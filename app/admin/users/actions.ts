'use server'

import { redirect } from 'next/navigation'

import { requireAdminSession } from '@/lib/auth/session'
import {
  activateUser,
  createPasswordResetToken,
  disableUser,
  rejectPendingUser,
  revokeSession,
  revokeUserSessions,
  setRegistrationOpen,
} from '@/lib/auth/store'
import { disconnectAllWebRtcReaders } from '@/lib/mediamtx'

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

export async function disableAction(userId: string, formData: FormData) {
  await runAdminAction(async (actorId) => {
    disableUser(actorId, userId)
    if (formData.get('disconnect') === 'true') await disconnectAllWebRtcReaders()
  })
  redirect(destination('notice', 'Account disabled and sessions revoked.'))
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
