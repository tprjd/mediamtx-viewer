import { randomUUID } from 'node:crypto'

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ChannelViewer } from '@/components/channel-viewer'
import { getChannel, getChannels } from '@/lib/channels'
import { channelPosterUrl } from '@/lib/channel-thumbnails'
import { getChannelStatuses } from '@/lib/mediamtx'
import { toPublicChannel } from '@/lib/public-channel'

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

  const configuredChannels = getChannels()
  const statuses = await getChannelStatuses(
    configuredChannels.map((item) => item.mediaPath),
  )
  const channels = configuredChannels.map((item) => {
    const status = statuses.get(item.mediaPath)!
    return toPublicChannel(item, status, channelPosterUrl(item, status.live))
  })
  const watchedChannel = channels.find((item) => item.slug === channel.slug)

  if (!watchedChannel) notFound()

  return (
    <ChannelViewer
      channel={watchedChannel}
      channels={channels}
      viewerId={randomUUID()}
    />
  )
}
