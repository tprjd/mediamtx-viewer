'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Menu, X } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import styles from './channel-navigation.module.css'

import { LiveRail } from '@/components/live-rail'
import type { PublicChannel } from '@/lib/types'

interface ChannelNavigationProps {
  channels: readonly PublicChannel[]
  watchedSlug?: string
}

function noopSubscribe(): () => void {
  return () => {}
}

function getHeaderTarget(): HTMLElement | null {
  return document.getElementById('channel-drawer-trigger')
}

export function ChannelNavigation({
  channels,
  watchedSlug,
}: ChannelNavigationProps) {
  const [open, setOpen] = useState(false)
  const triggerTarget = useSyncExternalStore(
    noopSubscribe,
    getHeaderTarget,
    () => null,
  )

  return (
    <>
      <LiveRail channels={channels} watchedSlug={watchedSlug} />
      <Dialog.Root open={open} onOpenChange={setOpen}>
        {triggerTarget &&
          createPortal(
            <Dialog.Trigger asChild>
              <button
                aria-label="Open Channel drawer"
                className={styles.drawerTrigger}
                type="button"
              >
                <Menu aria-hidden="true" />
              </button>
            </Dialog.Trigger>,
            triggerTarget,
          )}
        <Dialog.Portal>
          <Dialog.Overlay className={styles.drawerOverlay} />
          <Dialog.Content
            aria-describedby={undefined}
            className={styles.drawerContent}
          >
            <div className={styles.drawerHeading}>
              <Dialog.Title>Channels</Dialog.Title>
              <Dialog.Close asChild>
                <button
                  aria-label="Close Channel drawer"
                  className={styles.drawerClose}
                  type="button"
                >
                  <X aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>
            <LiveRail
              channels={channels}
              onChannelSelect={() => setOpen(false)}
              variant="drawer"
              watchedSlug={watchedSlug}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
