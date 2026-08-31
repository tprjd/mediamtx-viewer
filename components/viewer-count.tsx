import { UsersRound } from 'lucide-react'

import { cn } from '@/lib/utils'

interface ViewerCountProps {
  count: number | null
  live: boolean
  compact?: boolean
}

export function ViewerCount({ count, live, compact = false }: ViewerCountProps) {
  if (!live || count === null) return null

  const label = `${count} ${count === 1 ? 'viewer' : 'viewers'}`
  return (
    <span
      aria-label={label}
      className={cn('viewer-count', compact && 'viewer-count-compact')}
    >
      <UsersRound aria-hidden="true" />
      {compact ? count : label}
    </span>
  )
}
