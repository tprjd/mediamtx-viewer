'use client'

import { usePathname } from 'next/navigation'

import { SiteFooter } from '@/components/site-footer'

function isWatchPath(pathname: string | null): boolean {
  return pathname === '/watch' || pathname?.startsWith('/watch/') === true
}

export function AppFooter() {
  const pathname = usePathname()

  if (isWatchPath(pathname)) return null

  return <SiteFooter />
}
