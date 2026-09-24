import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth } from '@/lib/auth/auth'
import { getUserStatus } from '@/lib/auth/store'

/** Read Viewing access without renewing a cookie that this caller cannot send. */
export async function getActiveSession(requestHeaders?: Headers) {
  const session = await auth.api.getSession({
    headers: requestHeaders ?? await headers(),
    query: { disableRefresh: true, disableCookieCache: true },
  })
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
