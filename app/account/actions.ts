'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireActiveSession } from '@/lib/auth/session'
import { updateUserName } from '@/lib/auth/store'

function destination(kind: 'notice' | 'error', message: string): string {
  return `/account?${kind}=${encodeURIComponent(message)}`
}

export async function updateProfileNameAction(formData: FormData) {
  const session = await requireActiveSession()
  try {
    updateUserName(session.user.id, String(formData.get('name') ?? ''))
  } catch (error) {
    redirect(
      destination(
        'error',
        error instanceof Error ? error.message : 'Your name could not be updated.',
      ),
    )
  }

  revalidatePath('/')
  revalidatePath('/account')
  redirect(destination('notice', 'Name updated.'))
}
