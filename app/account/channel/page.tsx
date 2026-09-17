import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowUpRight, Check, ChevronDown, Download, Pencil, Power, RadioTower, ShieldCheck } from 'lucide-react'

import {
  disconnectBroadcastAction,
  updateDiscordNotificationsAction,
  updateChannelAction,
} from '@/app/account/channel/actions'
import { StreamKeyManager } from '@/components/auth/stream-key-manager'
import { Button, buttonVariants } from '@/components/ui/button'
import { requireActiveSession } from '@/lib/auth/session'
import { authEnvironment } from '@/lib/auth/env'
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

  const origin = authEnvironment.baseUrl
  const serverUrl = `rtmp://${new URL(origin).hostname}:${authEnvironment.mediaMtxRtmpPort}`
  const setupScript = getObsSetupScriptMetadata()

  return (
    <main className={channelStyles.dashboardPage}>
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
        <Link className={channelStyles.secondaryButton} href={`/watch/${channel.slug}`}>
          Open public channel <ArrowUpRight aria-hidden="true" />
        </Link>
      </section>

      {params.notice && <p className="notice-banner">{params.notice}</p>}
      {params.error && <p className="error-banner" role="alert">{params.error}</p>}

      <div className={channelStyles.dashboard}>
        <div className={channelStyles.panel}>
          <section className={channelStyles.panelBody}>
            <div className={channelStyles.publishingHeading}>
              <div>
                <h2><RadioTower aria-hidden="true" /> OBS publishing</h2>
                <p>Use these values in OBS Settings → Stream.</p>
              </div>
              <span className={channelStyles.serviceBadge}>Enhanced RTMP</span>
            </div>
            {channel.enabled ? (
              <StreamKeyManager
                hasKey={channel.hasStreamKey}
                keyHint={channel.streamKeyHint}
                mediaPath={channel.mediaPath}
                serverUrl={serverUrl}
              />
            ) : (
              <p className="error-banner">An administrator has disabled this channel.</p>
            )}
          </section>

          <section className={channelStyles.installer}>
            <div className={channelStyles.installerHeading}>
              <span className={channelStyles.installerIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="13" rx="2" />
                  <path d="M8 21h8M12 16v5m-1-15-2 4h5l-2 4" />
                </svg>
              </span>
              <div>
                <p className="eyebrow">Windows OBS setup</p>
                <h2>Download OBS setup</h2>
              </div>
            </div>
            <p>
              Install or update OBS and create managed AV1, HEVC, and H.264
              profiles at 1440p and 1080p with ready-made game and desktop scenes.
            </p>
            {channel.enabled ? (
              <>
                <div className={channelStyles.installerActions}>
                  <a
                    className={channelStyles.primaryButton}
                    download={OBS_SETUP_SCRIPT_FILENAME}
                    href="/account/channel/obs-setup.cmd"
                  >
                    <Download aria-hidden="true" /> Download OBS setup for Windows
                  </a>
                  <p className={channelStyles.obsSetupVersion}>1080p &amp; 1440p<br />Version {setupScript.version}</p>
                </div>
                <details className={channelStyles.securityDetails}>
                  <summary><ShieldCheck aria-hidden="true" /> Installer details &amp; security <ChevronDown aria-hidden="true" /></summary>
                  <p>SHA-256 <code>{setupScript.sha256}</code></p>
                  <p className={channelStyles.obsSetupNote}>
                    Version one is unsigned. Verify the checksum, then double-click
                    the downloaded file. It uses a temporary PowerShell process and
                    does not change your permanent execution policy. The launcher
                    opens this site for authorization and never contains your stream
                    key.
                  </p>
                </details>
              </>
            ) : (
              <p className="error-banner">Streaming must be enabled before setup.</p>
            )}
          </section>
        </div>
        <div className={channelStyles.rightColumn}>
          <section className={`${channelStyles.panel} ${channelStyles.panelBody}`}>
            <h2><Pencil aria-hidden="true" /> Channel details</h2>
            <p>Update the public title and description for your channel.</p>
            <form action={updateChannelAction} className={channelStyles.metadataForm}>
              <label htmlFor="channel-title">
                Title
                <input id="channel-title" defaultValue={channel.title} maxLength={120} name="title" required />
              </label>
              <label htmlFor="channel-description">
                Description
                <textarea
                  id="channel-description"
                  defaultValue={channel.description ?? ''}
                  maxLength={300}
                  name="description"
                  rows={4}
                />
              </label>
              <Button className={channelStyles.primaryButton} type="submit">Save details <Check aria-hidden="true" /></Button>
            </form>
          </section>

          <section className={`${channelStyles.panel} ${channelStyles.notificationPanel}`}>
            <form action={updateDiscordNotificationsAction} className={channelStyles.notificationForm}>
              <div className={channelStyles.notificationHeading}>
                <div className={channelStyles.notificationTitle}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M8 5a21 21 0 0 0-4 1c-2 3-3 7-3 11a17 17 0 0 0 6 3l1.5-2.5m7.5-12.5a21 21 0 0 1 4 1c2 3 3 7 3 11a17 17 0 0 1-6 3l-1.5-2.5M7 17a15 15 0 0 0 10 0M8 7a16 16 0 0 1 8 0M9 4l-1 3m7-3 1 3" />
                    <ellipse cx="8" cy="12.5" rx="1" ry="1.5" fill="currentColor" stroke="none" />
                    <ellipse cx="16" cy="12.5" rx="1" ry="1.5" fill="currentColor" stroke="none" />
                  </svg>
                  <div>
                    <h2>Discord notifications</h2>
                    <p>Send a notification when this channel goes live</p>
                  </div>
                </div>
                <label className={channelStyles.notificationSwitch}>
                  <input
                    aria-label="Send a notification when this channel goes live"
                    defaultChecked={channel.discordNotificationsEnabled}
                    name="discordNotificationsEnabled"
                    role="switch"
                    type="checkbox"
                  />
                  <span aria-hidden="true" />
                </label>
              </div>
              <p className={channelStyles.notificationDescription}>Choose whether live notifications may be sent for this channel.</p>
              <Button className={channelStyles.secondaryButton} type="submit">Save notification setting</Button>
            </form>
          </section>
        </div>
      </div>

      <section className={channelStyles.broadcastControls}>
        <div>
          <h2><Power aria-hidden="true" /> End broadcast</h2>
          <p>Disconnect the publisher and everyone currently watching this channel.</p>
        </div>
        <form action={disconnectBroadcastAction}>
          <Button className={channelStyles.dangerButton} type="submit" variant="secondary">End broadcast</Button>
        </form>
      </section>
    </main>
  )
}
