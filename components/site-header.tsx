import { RadioTower } from 'lucide-react'
import Link from 'next/link'
import { Suspense } from 'react'
import styles from './site-header.module.css'

import { UserMenu } from '@/components/auth/user-menu'
import { WatchRailToggle } from '@/components/watch-rail-toggle'
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
      <Link className={styles.brand} href="/" aria-label="Stream home">
        <span className={styles.brandMark}>
          <RadioTower className="size-4" aria-hidden="true" />
        </span>
        <span>Home Stream</span>
      </Link>
      <div className={styles.headerActions}>
        <WatchRailToggle />
        <Suspense fallback={null}>
          <AccountNavigation />
        </Suspense>
      </div>
    </header>
  )
}
