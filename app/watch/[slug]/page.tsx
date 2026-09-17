import { randomUUID } from 'node:crypto'

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

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
  const channel = getChannel(slug)

  if (!channel) return { title: 'Channel not found' }

  return {
    title: channel.title,
    description: channel.description,
    openGraph: {
      title: channel.title,
      description: channel.description,
      type: 'video.other',
      images: channel.poster ? [{ url: channel.poster }] : undefined,
    },
  }
}

export default async function WatchPage({ params }: WatchPageProps) {
  const { slug } = await params
  const channel = getChannel(slug)

  if (!channel) notFound()

  const channels = await getPublicChannels()
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
