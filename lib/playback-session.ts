import { authClient } from '@/lib/auth/client'

export type PlaybackSessionResult = 'authorized' | 'unauthorized' | 'unavailable'

export async function checkPlaybackSession(signal?: AbortSignal): Promise<PlaybackSessionResult> {
  try {
    const { data, error } = await authClient.getSession({ fetchOptions: { signal } })
    if (error) {
      return error.status === 401 || error.status === 403
        ? 'unauthorized'
        : 'unavailable'
    }
    return data ? 'authorized' : 'unauthorized'
  } catch {
    return 'unavailable'
  }
}
