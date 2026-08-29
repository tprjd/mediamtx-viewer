import { RadioTower } from 'lucide-react'
import Link from 'next/link'

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label="Stream home">
        <span className="brand-mark">
          <RadioTower className="size-4" aria-hidden="true" />
        </span>
        <span>Home Stream</span>
      </Link>
      <span className="hidden text-xs text-neutral-500 sm:block">
        Independent live video
      </span>
    </header>
  )
}
