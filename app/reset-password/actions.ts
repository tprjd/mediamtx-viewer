'use server'

import { consumeEmailToken } from '@/lib/auth/email'
import { hashPassword } from 'better-auth/crypto'

import { getDatabase } from '@/lib/auth/database'
import { consumePasswordResetToken } from '@/lib/auth/store'
import { resetPasswordSchema } from '@/lib/auth/validation'

export interface ResetState {
  status: 'idle' | 'error' | 'success'
  message?: string
}

export async function resetPasswordAction(
  _state: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  })
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Check the form and try again.',
    }
  }

  const passwordHash = await hashPassword(parsed.data.password)
  const database = getDatabase()
  const changed = database.transaction(() => {
    const userId = consumeEmailToken(parsed.data.token, 'reset') ?? consumePasswordResetToken(parsed.data.token)
    if (!userId) return false
    const result = database.prepare(`UPDATE account SET password = ?, updatedAt = ? WHERE userId = ? AND providerId = 'credential' AND issuer = 'local:credential'`)
      .run(passwordHash, Date.now(), userId)
    if (!result.changes) return false
    database.prepare('DELETE FROM session WHERE userId = ?').run(userId)
    database.prepare('DELETE FROM auth_reset_token WHERE user_id = ?').run(userId)
    database.prepare("DELETE FROM account_email_token WHERE user_id = ? AND purpose = 'reset'").run(userId)
    return true
  })()
  if (!changed) return { status: 'error', message: 'This reset link is invalid or has expired.' }

  return { status: 'success', message: 'Password changed. You can sign in now.' }
}

