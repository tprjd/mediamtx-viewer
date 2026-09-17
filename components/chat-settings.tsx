'use client'

import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, Settings2 } from 'lucide-react'
import { useSyncExternalStore } from 'react'

import styles from '@/components/chat-message-actions.module.css'

const STORAGE_KEY = 'home-stream.chat-timestamps'
const CHANGE_EVENT = 'home-stream:chat-timestamps-change'
let fallback: boolean | null = null
const TEXT_SIZE_KEY = 'home-stream.chat-text-size'
type ChatTextSize = 'small' | 'default' | 'large'
let textSizeFallback: ChatTextSize | null = null

function textSizeSnapshot(): ChatTextSize {
  if (textSizeFallback !== null) return textSizeFallback
  try {
    const value = window.localStorage.getItem(TEXT_SIZE_KEY)
    return value === 'small' || value === 'large' ? value : 'default'
  } catch {
    return 'default'
  }
}

function setTextSize(value: string) {
  if (value !== 'small' && value !== 'default' && value !== 'large') return
  textSizeFallback = value
  try {
    window.localStorage.setItem(TEXT_SIZE_KEY, value)
  } catch { /* Keep the choice usable for this visit when storage is unavailable. */ }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function useChatTextSize() {
  return useSyncExternalStore(subscribe, textSizeSnapshot, () => 'default' as const)
}

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
    if (event.key === null || event.key === TEXT_SIZE_KEY) {
      textSizeFallback = null
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
  const textSize = useChatTextSize()
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
          <DropdownMenu.Separator className={styles.menuSeparator} />
          <DropdownMenu.Label className={styles.menuLabel}>
            Message text size
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            aria-label="Message text size"
            value={textSize}
            onValueChange={setTextSize}
          >
            {(['small', 'default', 'large'] as const).map((size) => (
              <DropdownMenu.RadioItem
                key={size}
                value={size}
                onSelect={(event) => event.preventDefault()}
              >
                {size[0].toUpperCase() + size.slice(1)}
                <DropdownMenu.ItemIndicator className={styles.radioIndicator}>
                  <Check size={14} aria-hidden="true" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
