import { authClient } from '@/lib/auth/client'

export type ViewingAccessResult = 'authorized' | 'unauthorized' | 'unavailable'

/** Browser requests can receive the renewal cookie from Better Auth. */
export async function checkViewingAccess(signal?: AbortSignal): Promise<ViewingAccessResult> {
  try {
    const { data, error } = await authClient.getSession({
      fetchOptions: { signal, cache: 'no-store' },
    })
    if (error) {
      return error.status === 401 || error.status === 403
        ? 'unauthorized'
        : 'unavailable'
    }
    if (!data) return 'unauthorized'
    if ('activationStatus' in data.user && data.user.activationStatus !== 'active') {
      return 'unauthorized'
    }
    return 'authorized'
  } catch {
    return 'unavailable'
  }
}
