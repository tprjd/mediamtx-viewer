'use server'

import { redirect } from 'next/navigation'

import { requireActiveSession } from '@/lib/auth/session'
import {
  approveObsSetupSession,
  denyObsSetupSession,
} from '@/lib/obs-setup'

function codeFrom(formData: FormData): string {
  return String(formData.get('userCode') ?? '').trim().toUpperCase()
}
export async function approveObsSetupAction(formData: FormData) {
  const session = await requireActiveSession()
  const userCode = codeFrom(formData)
  try {
    approveObsSetupSession(userCode, session.user.id)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'OBS setup could not be authorized.'
    redirect(
      `/account/channel/obs-setup/${encodeURIComponent(userCode)}?error=${encodeURIComponent(message)}`,
    )
  }
  redirect(
    '/account/channel?notice=OBS%20setup%20authorized.%20Return%20to%20PowerShell%20to%20finish.',
  )
}

export async function denyObsSetupAction(formData: FormData) {
  const session = await requireActiveSession()
  const userCode = codeFrom(formData)
  try {
    denyObsSetupSession(userCode, session.user.id)
  } catch {
    redirect('/account/channel?error=That%20OBS%20setup%20request%20is%20no%20longer%20available.')
  }
  redirect('/account/channel?notice=OBS%20setup%20request%20denied.')
}
