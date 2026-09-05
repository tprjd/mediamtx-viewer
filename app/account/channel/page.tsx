import type { Metadata } from 'next'
import Link from 'next/link'
import { Download, RadioTower } from 'lucide-react'

import {
  disconnectBroadcastAction,
  updateDiscordNotificationsAction,
  updateChannelAction,
} from '@/app/account/channel/actions'
import { StreamKeyManager } from '@/components/auth/stream-key-manager'
import { Button, buttonVariants } from '@/components/ui/button'
import { requireActiveSession } from '@/lib/auth/session'
import { getOwnedChannel } from '@/lib/channels'
import {
  OBS_SETUP_SCRIPT_FILENAME,
  getObsSetupScriptMetadata,
} from '@/lib/obs-setup-script'
import accountStyles from '../account.module.css'
import channelStyles from './channel.module.css'

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
      <main className={accountStyles.accountLayout}>
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
  const setupScript = getObsSetupScriptMetadata()

  return (
    <main className={`${accountStyles.accountLayout} ${channelStyles.channelAccountLayout}`}>
      <section className={channelStyles.channelAccountHeading}>
        <div className={channelStyles.channelAccountCopy}>
          <p className="eyebrow">My channel</p>
          <h1>{channel.title}</h1>
          <p className={channelStyles.channelAccountMeta}>
            <Link href={`/watch/${channel.slug}`}>/watch/{channel.slug}</Link>
            <span aria-hidden="true">·</span>
            <span>
              {channel.enabled ? 'Streaming enabled' : 'Streaming disabled'}
            </span>
          </p>
        </div>
        <RadioTower aria-hidden="true" />
      </section>

      {params.notice && <p className="notice-banner">{params.notice}</p>}
      {params.error && <p className="error-banner" role="alert">{params.error}</p>}

      <section className={`${accountStyles.accountPanel} ${channelStyles.obsSetupPanel}`}>
        <div className={channelStyles.obsSetupHeading}>
          <div>
            <h2>Windows OBS setup</h2>
            <p>
              Install or update OBS and create managed AV1, HEVC, and H.264
              profiles at 1440p and 1080p with ready-made game and desktop
              scenes.
            </p>
          </div>
          <Download aria-hidden="true" />
        </div>
        {channel.enabled ? (
          <>
            <a
              className={buttonVariants()}
              download={OBS_SETUP_SCRIPT_FILENAME}
              href="/account/channel/obs-setup.cmd"
            >
              Download Windows setup
            </a>
            <p className={channelStyles.obsSetupVersion}>
              Version {setupScript.version} · SHA-256{' '}
              <code>{setupScript.sha256}</code>
            </p>
            <p className={channelStyles.obsSetupNote}>
              Version one is unsigned. Verify the checksum, then double-click
              the downloaded file. It uses a temporary PowerShell process and
              does not change your permanent execution policy. The launcher
              opens this site for authorization and never contains your stream
              key.
            </p>
          </>
        ) : (
          <p className="error-banner">Streaming must be enabled before setup.</p>
        )}
      </section>

      <section className={accountStyles.accountPanel}>
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

      <section className={accountStyles.accountPanel}>
        <h2>Discord notifications</h2>
        <p>Choose whether live notifications may be sent for this channel.</p>
        <form action={updateDiscordNotificationsAction} className={accountStyles.channelMetadataForm}>
          <label className={channelStyles.discordNotificationToggle}>
            <input
              defaultChecked={channel.discordNotificationsEnabled}
              name="discordNotificationsEnabled"
              type="checkbox"
            />
            Send a notification when this channel goes live
          </label>
          <Button type="submit">Save notification setting</Button>
        </form>
      </section>

      <section className={accountStyles.accountPanel}>
        <h2>Channel details</h2>
        <form action={updateChannelAction} className={accountStyles.channelMetadataForm}>
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

      <section className={accountStyles.accountPanel}>
        <h2>End broadcast</h2>
        <p>Disconnect the publisher and everyone currently watching this channel.</p>
        <form action={disconnectBroadcastAction}>
          <Button type="submit" variant="secondary">Disconnect current broadcast</Button>
        </form>
      </section>
    </main>
  )
}
