'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { requireActiveSession } from '@/lib/auth/session'
import {
  createOrRotateStreamKey,
  getOwnedChannel,
  updateOwnedChannelMetadata,
} from '@/lib/channels'
import {
  disconnectChannelPublisher,
  disconnectChannelSessions,
} from '@/lib/mediamtx'

export interface StreamKeyActionState {
  key?: string
  hint?: string
  error?: string
  warning?: string
}

function destination(kind: 'notice' | 'error', message: string): string {
  return `/account/channel?${kind}=${encodeURIComponent(message)}`
}

export async function generateStreamKeyAction(): Promise<StreamKeyActionState> {
  const session = await requireActiveSession()
  try {
    const result = createOrRotateStreamKey(session.user.id)
    let warning: string | undefined
    if (result.rotated) {
      try {
        await disconnectChannelPublisher(result.mediaPath)
      } catch {
        warning =
          'The old key is revoked, but MediaMTX could not confirm disconnection of the current broadcast.'
      }
    }
    revalidatePath('/account/channel')
    return { key: result.token, hint: result.hint, warning }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'The key could not be generated.',
    }
  }
}

export async function updateChannelAction(formData: FormData) {
  const session = await requireActiveSession()
  try {
    updateOwnedChannelMetadata(session.user.id, {
      title: String(formData.get('title') ?? ''),
      description: String(formData.get('description') ?? ''),
    })
  } catch (error) {
    redirect(
      destination(
        'error',
        error instanceof Error ? error.message : 'The channel could not be updated.',
      ),
    )
  }
  revalidatePath('/')
  revalidatePath('/account/channel')
  redirect(destination('notice', 'Channel details updated.'))
}

export async function disconnectBroadcastAction() {
  const session = await requireActiveSession()
  const channel = getOwnedChannel(session.user.id)
  if (!channel) redirect(destination('error', 'You do not have a channel.'))
  let notice: string
  try {
    const disconnected = await disconnectChannelSessions(channel.mediaPath)
    notice =
      disconnected > 0
        ? 'The broadcast and connected viewers were disconnected.'
        : 'No active broadcast was found.'
  } catch {
    redirect(destination('error', 'MediaMTX could not disconnect the broadcast.'))
  }
  redirect(destination('notice', notice))
}
