import { Radio, WifiOff } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { StreamState } from '@/lib/types'

interface StatusBadgeProps {
  state: StreamState
  compact?: boolean
}

export function StatusBadge({ state, compact = false }: StatusBadgeProps) {
  const live = state === 'live'
  const unavailable = state === 'unavailable'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em]',
        live && 'border-red-400/20 bg-red-500/15 text-red-300',
        state === 'offline' &&
          'border-white/10 bg-white/5 text-neutral-400',
        unavailable && 'border-amber-400/20 bg-amber-500/10 text-amber-300',
      )}
    >
      {live ? (
        <>
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-400 opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2 rounded-full bg-red-400" />
          </span>
          Live
        </>
      ) : unavailable ? (
        <>
          <WifiOff className="size-3" aria-hidden="true" />
          {compact ? 'Unknown' : 'Status unavailable'}
        </>
      ) : (
        <>
          <Radio className="size-3" aria-hidden="true" />
          Offline
        </>
      )}
    </span>
  )
}
