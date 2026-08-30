import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth } from '@/lib/auth/auth'
import { getUserStatus } from '@/lib/auth/store'

export async function getActiveSession() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session || getUserStatus(session.user.id) !== 'active') return null
  return session
}

export async function requireActiveSession() {
  const session = await getActiveSession()
  if (!session) redirect('/login')
  return session
}

export async function requireAdminSession() {
  const session = await requireActiveSession()
  if (session.user.role !== 'admin') redirect('/')
  return session
}

