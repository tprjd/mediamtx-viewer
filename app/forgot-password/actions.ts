'use server'
import { headers } from 'next/headers'
import { allowRecoveryRequest, requestPasswordRecovery } from '@/lib/auth/email'

export async function forgotPasswordAction(_previous: string, form: FormData): Promise<string> {
  const email = String(form.get('email') ?? '').trim()
  const requestHeaders = await headers()
  const address = requestHeaders.get('x-forwarded-for')?.split(',').at(-1)?.trim() ?? 'unknown'
  if (email.length <= 254 && email.includes('@') && allowRecoveryRequest(address)) {
    try { await requestPasswordRecovery(email) } catch { console.error('Password recovery email delivery failed.') }
  }
  return 'If this address belongs to an eligible account, a password reset link will arrive shortly. The link expires after 15 minutes.'
}
