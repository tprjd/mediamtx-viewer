import { ArrowDown } from 'lucide-react'

import { ChannelDirectory } from '@/components/channel-directory'
import { getChannels } from '@/lib/channels'
import { getChannelStatus } from '@/lib/mediamtx'
import { toPublicChannel } from '@/lib/public-channel'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const configuredChannels = getChannels()
  const statuses = await Promise.all(
    configuredChannels.map((channel) => getChannelStatus(channel.mediaPath)),
  )
  const channels = configuredChannels.map((channel, index) =>
    toPublicChannel(channel, statuses[index]),
  )
  const liveCount = channels.filter((channel) => channel.status.live).length

  return (
    <main className="home-layout">
      <section className="hero">
        <div>
          <p className="eyebrow">
            {liveCount > 0
              ? `${liveCount} ${liveCount === 1 ? 'channel' : 'channels'} live now`
              : 'Broadcasts appear here when live'}
          </p>
          <h1>Pull up a chair.</h1>
          <p className="hero-copy">
            Games and occasional broadcasts, served directly without ads,
            tracking, or a crowded chat panel.
          </p>
        </div>
        <a className="hero-jump" href="#channels">
          Browse channels
          <ArrowDown className="size-4" aria-hidden="true" />
        </a>
      </section>

      <section id="channels" className="channel-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Watch</p>
            <h2>Channels</h2>
          </div>
          <p>Status updates automatically.</p>
        </div>
        <ChannelDirectory initialChannels={channels} />
      </section>
    </main>
  )
}
