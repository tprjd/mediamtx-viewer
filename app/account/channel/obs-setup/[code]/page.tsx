import type { Metadata } from 'next'
import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'

import {
  approveObsSetupAction,
  denyObsSetupAction,
} from '@/app/account/channel/obs-setup/actions'
import { Button, buttonVariants } from '@/components/ui/button'
import { requireActiveSession } from '@/lib/auth/session'
import { getOwnedChannel } from '@/lib/channels'
import { getObsSetupApproval } from '@/lib/obs-setup'
import accountStyles from '../../../account.module.css'
import channelStyles from '../../channel.module.css'

export const metadata: Metadata = { title: 'Authorize OBS setup' }
export const dynamic = 'force-dynamic'

interface ObsSetupApprovalPageProps {
  params: Promise<{ code: string }>
  searchParams: Promise<{ error?: string }>
}
export default async function ObsSetupApprovalPage({
  params,
  searchParams,
}: ObsSetupApprovalPageProps) {
  const [session, { code }, query] = await Promise.all([
    requireActiveSession(),
    params,
    searchParams,
  ])
  const userCode = decodeURIComponent(code).trim().toUpperCase()
  const [setup, channel] = [
    getObsSetupApproval(userCode),
    getOwnedChannel(session.user.id),
  ]
  const available = setup?.status === 'pending' && channel?.enabled

  return (
    <main className={`${accountStyles.accountLayout} ${channelStyles.channelAccountLayout}`}>
      <section className={channelStyles.channelAccountHeading}>
        <div>
          <p className="eyebrow">Windows OBS setup</p>
          <h1>Authorize this computer</h1>
          <p>Code {setup?.userCode ?? userCode}</p>
        </div>
        <ShieldCheck aria-hidden="true" />
      </section>

      {query.error && <p className="error-banner" role="alert">{query.error}</p>}

      <section className={accountStyles.accountPanel}>
        {available ? (
          <>
            <h2>Connect to {channel.title}</h2>
            <p>
              Approving sends this channel&apos;s WHIP address and a newly generated
              publishing key to the waiting setup script. Any previous OBS key
              is revoked and a current broadcast may be disconnected.
            </p>
            <div className={channelStyles.obsSetupApprovalActions}>
              <form action={approveObsSetupAction}>
                <input name="userCode" type="hidden" value={setup.userCode} />
                <Button type="submit">Authorize OBS setup</Button>
              </form>
              <form action={denyObsSetupAction}>
                <input name="userCode" type="hidden" value={setup.userCode} />
                <Button type="submit" variant="secondary">Deny</Button>
              </form>
            </div>
          </>
        ) : (
          <>
            <h2>Setup request unavailable</h2>
            <p>
              This code is invalid, expired, already used, or streaming is no
              longer enabled for this account. Return to PowerShell or download
              a new setup script from your channel page.
            </p>
            <Link className={buttonVariants({ variant: 'secondary' })} href="/account/channel">
              Back to my channel
            </Link>
          </>
        )}
      </section>
    </main>
  )
}
