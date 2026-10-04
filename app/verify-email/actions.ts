'use server'
import { redirect } from 'next/navigation'
import { requireActiveSession } from '@/lib/auth/session'
import { consumeEmailToken, sendAccountEmail } from '@/lib/auth/email'

export async function sendVerificationAction(): Promise<{ error?: string }> {
  const session = await requireActiveSession()
  try { await sendAccountEmail(session.user.id, 'verify'); return {} }
  catch (error) { return { error: error instanceof Error ? error.message : 'Email could not be sent.' } }
}

export async function verifyEmailAction(form: FormData) {
  const token = String(form.get('token') ?? '')
  const userId = token.length <= 128 ? consumeEmailToken(token, 'verify') : null
  redirect(userId ? '/verify-email?verified=true' : '/verify-email?error=expired')
}
