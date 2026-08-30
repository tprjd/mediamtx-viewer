'use server'

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
  const userId = consumePasswordResetToken(parsed.data.token)
  if (!userId) {
    return { status: 'error', message: 'This reset link is invalid or has expired.' }
  }

  const database = getDatabase()
  database.transaction(() => {
    database
      .prepare(
        `UPDATE account SET password = ?, updatedAt = ?
         WHERE userId = ? AND providerId = 'credential' AND issuer = 'local:credential'`,
      )
      .run(passwordHash, Date.now(), userId)
    database.prepare('DELETE FROM session WHERE userId = ?').run(userId)
  })()

  return { status: 'success', message: 'Password changed. You can sign in now.' }
}

