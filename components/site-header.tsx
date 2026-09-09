import { RadioTower } from 'lucide-react'
import Link from 'next/link'
import { Suspense } from 'react'
import styles from './site-header.module.css'

import { UserMenu } from '@/components/auth/user-menu'
import { getActiveSession } from '@/lib/auth/session'
import { getOwnedChannel } from '@/lib/channels'

async function AccountNavigation() {
  const session = await getActiveSession()
  const hasOwnedChannel = session
    ? Boolean(getOwnedChannel(session.user.id))
    : false

  return (
    <UserMenu
      hasOwnedChannel={hasOwnedChannel}
      user={
        session ? { name: session.user.name, role: session.user.role } : null
      }
    />
  )
}

export function SiteHeader() {
  return (
    <header className={styles.siteHeader}>
      <div className={styles.headerStart}>
        <div
          className={styles.channelDrawerTarget}
          id="channel-drawer-trigger"
        />
        <Link className={styles.brand} href="/" aria-label="FrankerzSpam home">
          <span className={styles.brandMark}>
            <RadioTower className="size-4" aria-hidden="true" />
          </span>
          <span>FrankerzSpam</span>
        </Link>
      </div>
      <div className={styles.headerActions}>
        <Suspense fallback={null}>
          <AccountNavigation />
        </Suspense>
      </div>
    </header>
  )
}
