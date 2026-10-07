'use server'

import { completePasswordReset } from '@/lib/auth/account-credentials-recovery'
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

  const changed = await completePasswordReset(parsed.data.token, parsed.data.password)
  if (!changed) return { status: 'error', message: 'This reset link is invalid or has expired.' }

  return { status: 'success', message: 'Password changed. You can sign in now.' }
}
