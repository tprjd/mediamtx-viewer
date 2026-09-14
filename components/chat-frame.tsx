'use client'

import * as Collapsible from '@radix-ui/react-collapsible'
import { MessageSquare, X } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'

import styles from '@/components/channel-viewer.module.css'

interface ChatFrameProps {
  children:
    ReactNode | ((active: boolean, explicitlyOpened: boolean) => ReactNode)
  closeButtonRef?: (element: HTMLButtonElement | null) => void
  open?: boolean
  focusComposer?: boolean
  label: string
  narrowLayout: boolean
  onClose: () => void
}

export function ChatFrame({
  children,
  closeButtonRef,
  label,
  open = true,
  focusComposer = false,
  narrowLayout,
  onClose,
}: ChatFrameProps) {
  const [mobileExpanded, setMobileExpanded] = useState(
    focusComposer && narrowLayout,
  )
  const [explicitlyOpened, setExplicitlyOpened] = useState(false)
  const contentId = useId()
  const active = open && (!narrowLayout || mobileExpanded)

  const [previousFocusRequest, setPreviousFocusRequest] =
    useState(focusComposer)
  if (previousFocusRequest !== focusComposer) {
    setPreviousFocusRequest(focusComposer)
    if (focusComposer) setMobileExpanded(narrowLayout)
  }

  return (
    <Collapsible.Root
      asChild
      open={active}
      onOpenChange={(expanded) => {
        setMobileExpanded(expanded)
        setExplicitlyOpened(expanded)
      }}
    >
      <aside
        className={styles.chatPlaceholder}
        aria-label={label}
        hidden={!open}
      >
        <div className={styles.chatHeading}>
          <div className={styles.chatTitle}>
            <MessageSquare aria-hidden="true" />
            <strong>Chat</strong>
          </div>
          <div className={styles.chatActions}>
            <Collapsible.Trigger
              asChild
              aria-controls={contentId}
              className={styles.chatToggle}
            >
              <button type="button">
                <MessageSquare aria-hidden="true" />
                <span>Chat</span>
              </button>
            </Collapsible.Trigger>
            <button
              aria-label="Close Chat"
              className={styles.chatClose}
              onClick={onClose}
              ref={closeButtonRef}
              title="Close Chat"
              type="button"
            >
              <X aria-hidden="true" />
            </button>
          </div>
        </div>
        <Collapsible.Content
          forceMount
          hidden={!active}
          className={styles.chatContent}
          id={contentId}
        >
          {typeof children === 'function'
            ? children(active, focusComposer || explicitlyOpened)
            : children}
        </Collapsible.Content>
      </aside>
    </Collapsible.Root>
  )
}

export function ChatPlaceholder({
  closeButtonRef,
  narrowLayout,
  onClose,
}: Omit<ChatFrameProps, 'children' | 'label'>) {
  return (
    <ChatFrame
      closeButtonRef={closeButtonRef}
      label="Chat placeholder"
      narrowLayout={narrowLayout}
      onClose={onClose}
    >
      <div className={styles.chatEmptyState}>
        <MessageSquare className="size-7" aria-hidden="true" />
        <p>Chat is coming soon</p>
        <span>Conversation will be available here in a future update.</span>
      </div>
      <input
        aria-label="Chat message"
        disabled
        placeholder="Chat is unavailable"
      />
    </ChatFrame>
  )
}
