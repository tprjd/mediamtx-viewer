'use client'

import { EyeOff, PanelLeftOpen } from 'lucide-react'
import { usePathname } from 'next/navigation'

import styles from './site-header.module.css'

import { useLiveRailPreference } from '@/components/use-live-rail-preference'

export function WatchRailToggle() {
  const pathname = usePathname()
  const { preference, setPreference } = useLiveRailPreference()

  if (!pathname?.startsWith('/watch/')) return null

  const hidden = preference === 'hidden'

  return (
    <button
      aria-pressed={hidden}
      className={styles.railToggle}
      onClick={() => setPreference(hidden ? 'expanded' : 'hidden')}
      title={hidden ? 'Show live rail' : 'Hide live rail'}
      type="button"
    >
      {hidden ? (
        <PanelLeftOpen className="size-4" aria-hidden="true" />
      ) : (
        <EyeOff className="size-4" aria-hidden="true" />
      )}
      <span>{hidden ? 'Show live rail' : 'Hide live rail'}</span>
    </button>
  )
}
