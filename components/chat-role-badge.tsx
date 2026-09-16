'use client'

import * as Tooltip from '@radix-ui/react-tooltip'
import { Crown, ShieldCheck } from 'lucide-react'
import { useRef, useState } from 'react'

import styles from '@/components/channel-viewer.module.css'

export function ChatRoleBadge({ role }: { role: 'owner' | 'admin' }) {
  const [open, setOpen] = useState(false)
  const touchPointer = useRef(false)
  const openAtPointerDown = useRef(false)
  const label = role === 'owner' ? 'Channel owner' : 'Administrator'

  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root open={open} onOpenChange={setOpen}>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label={label}
            className={`${styles.chatBadge} ${role === 'owner' ? styles.chatOwnerBadge : styles.chatAdminBadge}`}
            onPointerDown={(event) => {
              touchPointer.current = event.pointerType === 'touch'
              openAtPointerDown.current = open
            }}
            onClick={(event) => {
              if (!touchPointer.current) return
              // Touch focus can open the tooltip before click. Toggle from the pointer-down state.
              event.preventDefault()
              setOpen(!openAtPointerDown.current)
            }}
          >
            {role === 'owner' ? (
              <Crown size={12} aria-hidden="true" />
            ) : (
              <ShieldCheck size={12} aria-hidden="true" />
            )}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className={styles.chatBadgeTooltip}
            side="top"
            sideOffset={6}
            collisionPadding={10}
          >
            <strong>{label}</strong>
            <span>
              {role === 'owner'
                ? 'Manages this channel and moderates its Chat.'
                : 'Moderates Chat across all channels.'}
            </span>
            <Tooltip.Arrow />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
