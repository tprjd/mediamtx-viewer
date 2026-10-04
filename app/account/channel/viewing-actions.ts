'use server'
import { revalidatePath } from 'next/cache'
import { requireActiveSession } from '@/lib/auth/session'
import { decideViewingRequest, markNotificationsRead, requestViewing, setNotificationSound } from '@/lib/viewing-requests'
import { dispatchAccessRevocations } from '@/lib/access-revocations'

export async function requestViewingAction(slug: string) {
  const session = await requireActiveSession()
  try {
    requestViewing(session.user.id, slug)
    revalidatePath(`/watch/${slug}`)
    return { success: true }
  } catch (error) { return { error: error instanceof Error ? error.message : 'Request could not be sent.' } }
}

export async function decideViewingAction(id: string, revision: number, decision: 'approved' | 'rejected' | 'revoked') {
  const session = await requireActiveSession()
  if (!['approved', 'rejected', 'revoked'].includes(decision) || !Number.isSafeInteger(revision)) return { error: 'Invalid decision.' }
  try {
    decideViewingRequest(session.user.id, id, revision, decision)
    await dispatchAccessRevocations()
    revalidatePath('/account/channel')
    revalidatePath('/', 'layout')
    return { success: true }
  } catch (error) { return { error: error instanceof Error ? error.message : 'Decision could not be saved.' } }
}

export async function readNotificationsAction(id?: number) {
  const session = await requireActiveSession()
  if (id !== undefined && !Number.isSafeInteger(id)) return
  markNotificationsRead(session.user.id, id)
}

export async function notificationSoundAction(enabled: boolean) {
  const session = await requireActiveSession()
  setNotificationSound(session.user.id, enabled === true)
  revalidatePath('/account/channel')
}
