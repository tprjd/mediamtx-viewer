import { RadioTower } from 'lucide-react'
import Link from 'next/link'

import { UserMenu } from '@/components/auth/user-menu'

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="Stream home">
        <span className="brand-mark">
          <RadioTower className="size-4" aria-hidden="true" />
        </span>
        <span>Home Stream</span>
      </Link>
      <UserMenu />
    </header>
  )
}
