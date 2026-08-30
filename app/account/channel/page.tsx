import type { Metadata } from 'next'
import Link from 'next/link'
import { RadioTower } from 'lucide-react'

import {
  disconnectBroadcastAction,
  updateChannelAction,
} from '@/app/account/channel/actions'
import { StreamKeyManager } from '@/components/auth/stream-key-manager'
import { Button, buttonVariants } from '@/components/ui/button'
import { requireActiveSession } from '@/lib/auth/session'
import { getOwnedChannel } from '@/lib/channels'

export const metadata: Metadata = { title: 'My channel' }
export const dynamic = 'force-dynamic'

interface ChannelAccountPageProps {
  searchParams: Promise<{ notice?: string; error?: string }>
}

export default async function ChannelAccountPage({
  searchParams,
}: ChannelAccountPageProps) {
  const [session, params] = await Promise.all([requireActiveSession(), searchParams])
  const channel = getOwnedChannel(session.user.id)

  if (!channel) {
    return (
      <main className="account-layout">
        <section>
          <p className="eyebrow">My channel</p>
          <h1>Viewer account</h1>
          <p>An administrator has not granted streaming access to this account.</p>
        </section>
        <Link className={buttonVariants({ variant: 'secondary' })} href="/account">
          Back to account
        </Link>
      </main>
    )
  }

  const origin = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'
  const serverUrl = `${origin}/publish/whip/${channel.mediaPath}/whip`

  return (
    <main className="account-layout channel-account-layout">
      <section className="channel-account-heading">
        <div>
          <p className="eyebrow">My channel</p>
          <h1>{channel.displayName}</h1>
          <p>
            <Link href={`/watch/${channel.slug}`}>/watch/{channel.slug}</Link> ·{' '}
            {channel.enabled ? 'Streaming enabled' : 'Streaming disabled'}
          </p>
        </div>
        <RadioTower aria-hidden="true" />
      </section>

      {params.notice && <p className="notice-banner">{params.notice}</p>}
      {params.error && <p className="error-banner" role="alert">{params.error}</p>}

      <section className="account-panel">
        <h2>OBS publishing</h2>
        <p>
          Use these values in OBS Settings → Stream. The stream key is separate
          from your website password.
        </p>
        {channel.enabled ? (
          <StreamKeyManager
            hasKey={channel.hasStreamKey}
            keyHint={channel.streamKeyHint}
            serverUrl={serverUrl}
          />
        ) : (
          <p className="error-banner">An administrator has disabled this channel.</p>
        )}
      </section>

      <section className="account-panel">
        <h2>Channel details</h2>
        <form action={updateChannelAction} className="channel-metadata-form">
          <label>
            Title
            <input defaultValue={channel.title} maxLength={120} name="title" required />
          </label>
          <label>
            Description
            <textarea
              defaultValue={channel.description ?? ''}
              maxLength={300}
              name="description"
              rows={4}
            />
          </label>
          <Button type="submit">Save details</Button>
        </form>
      </section>

      <section className="account-panel">
        <h2>End broadcast</h2>
        <p>Disconnect the publisher and everyone currently watching this channel.</p>
        <form action={disconnectBroadcastAction}>
          <Button type="submit" variant="secondary">Disconnect current broadcast</Button>
        </form>
      </section>
    </main>
  )
}
