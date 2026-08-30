import { RadioTower } from 'lucide-react'
import Link from 'next/link'
import { Suspense } from 'react'

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
    <header className="site-header">
      <Link className="brand" href="/" aria-label="Stream home">
        <span className="brand-mark">
          <RadioTower className="size-4" aria-hidden="true" />
        </span>
        <span>Home Stream</span>
      </Link>
      <Suspense fallback={null}>
        <AccountNavigation />
      </Suspense>
    </header>
  )
}
