import { randomUUID } from 'node:crypto'

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { requireActiveSession } from '@/lib/auth/session'
import { canSeeChannel } from '@/lib/viewing-access'
import { ChannelViewer } from '@/components/channel-viewer'
import { getChannel } from '@/lib/channels'
import { getPublicChannels } from '@/lib/channel-reads'
import { isChatEnabled } from '@/lib/chat-environment'

export const dynamic = 'force-dynamic'

interface WatchPageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: WatchPageProps): Promise<Metadata> {
  const { slug } = await params
  const session = await requireActiveSession()
  const channel = canSeeChannel(session.user.id, slug) ? getChannel(slug, session.user.id) : undefined

  if (!channel) return { title: 'Channel not found' }

  return {
    title: channel.title,

    openGraph: {
      title: channel.title,

      type: 'video.other',

    },
  }
}

export default async function WatchPage({ params }: WatchPageProps) {
  const { slug } = await params
  const session = await requireActiveSession()
  const channel = canSeeChannel(session.user.id, slug) ? getChannel(slug, session.user.id) : undefined

  if (!channel) notFound()

  const channels = await getPublicChannels(session.user.id)
  const watchedChannel = channels.find((item) => item.slug === channel.slug)

  if (!watchedChannel) notFound()

  return (
    <ChannelViewer
      channel={watchedChannel}
      channels={channels}
      chatEnabled={isChatEnabled()}
      key={watchedChannel.slug}
      viewerId={randomUUID()}
    />
  )
}
