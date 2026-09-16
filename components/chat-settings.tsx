'use client'

import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Settings2 } from 'lucide-react'
import { useSyncExternalStore } from 'react'

import styles from '@/components/chat-message-actions.module.css'

const STORAGE_KEY = 'home-stream.chat-timestamps'
const CHANGE_EVENT = 'home-stream:chat-timestamps-change'
let fallback: boolean | null = null

function snapshot() {
  if (fallback !== null) return fallback
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) {
      fallback = null
      listener()
    }
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGE_EVENT, listener)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(CHANGE_EVENT, listener)
  }
}

function setTimestamps(checked: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(checked))
    fallback = null
  } catch {
    fallback = checked
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function useChatTimestamps() {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}

export function ChatSettings({ showTimestamps }: { showTimestamps: boolean }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className={styles.headerButton}
          type="button"
          aria-label="Chat settings"
        >
          <Settings2 size={17} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={`${styles.menu} ${styles.settingsMenu}`}
          sideOffset={8}
          align="end"
          collisionPadding={12}
        >
          <DropdownMenu.Label className={styles.menuLabel}>
            Chat settings
          </DropdownMenu.Label>
          <DropdownMenu.CheckboxItem
            checked={showTimestamps}
            onCheckedChange={setTimestamps}
            onSelect={(event) => event.preventDefault()}
          >
            <span>
              <strong>Show timestamps</strong>
              <small>Show the time before each message</small>
            </span>
            <span className={styles.checkBox} aria-hidden="true">
              <span />
            </span>
          </DropdownMenu.CheckboxItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
