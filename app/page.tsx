import { HomeDashboard } from '@/components/home-dashboard'
import { getActiveSession } from '@/lib/auth/session'
import { getChannels, getOwnedChannel } from '@/lib/channels'
import { channelPosterUrl } from '@/lib/channel-thumbnails'
import { getChannelStatuses } from '@/lib/mediamtx'
import { toPublicChannel } from '@/lib/public-channel'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const configuredChannels = getChannels()
  const [statuses, session] = await Promise.all([
    getChannelStatuses(configuredChannels.map((channel) => channel.mediaPath)),
    getActiveSession(),
  ])
  const channels = configuredChannels.map((channel) => {
    const status = statuses.get(channel.mediaPath)!
    return toPublicChannel(
      channel,
      status,
      channelPosterUrl(channel, status.live),
    )
  })

  return (
    <HomeDashboard
      capabilities={{
        hasOwnedChannel: session
          ? Boolean(getOwnedChannel(session.user.id))
          : false,
        isAdmin: session?.user.role === 'admin',
      }}
      initialChannels={channels}
    />
  )
}
