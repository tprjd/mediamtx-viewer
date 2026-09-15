'use client'

import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { MoreHorizontal } from 'lucide-react'
import { useRef, useState } from 'react'

import type { PublicChatMessage } from '@/lib/chat-types'
import styles from '@/components/chat-message-actions.module.css'

interface RemovedMessageDetails {
  content: string
  profileName: string
  authorTag: string
  category: string
  note: string | null
}

export function ChatMessageActions({
  message,
  channelSlug,
  onRemoved,
}: {
  message: PublicChatMessage
  channelSlug: string
  onRemoved: (message: PublicChatMessage) => void
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [actions, setActions] = useState<{
    canRemove: boolean
    canInspect: boolean
  } | null>(null)
  const [menuError, setMenuError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'remove' | 'inspect' | null>(null)
  const [category, setCategory] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<RemovedMessageDetails | null>(null)
  const endpoint = `/api/channels/${encodeURIComponent(channelSlug)}/chat/messages/${encodeURIComponent(message.id)}/removal`

  async function loadActions() {
    setActions(null)
    setMenuError(null)
    try {
      const response = await fetch(`${endpoint}?permissions=1`, {
        cache: 'no-store',
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'Chat is unavailable.')
      setActions(result)
    } catch (error) {
      setMenuError(
        error instanceof Error ? error.message : 'Chat is unavailable.',
      )
    }
  }

  async function inspect() {
    setDialog('inspect')
    setDetails(null)
    setError(null)
    setBusy(true)
    try {
      const response = await fetch(endpoint, { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.error ?? 'Could not inspect the message.')
      setDetails(result)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Chat is unavailable.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category, note }),
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.error ?? 'Could not remove the message.')
      onRemoved(result.message)
      setDialog(null)
      setNote('')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Chat is unavailable.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DropdownMenu.Root
        onOpenChange={(open) => {
          if (open) void loadActions()
        }}
      >
        <DropdownMenu.Trigger asChild>
          <button
            className={styles.trigger}
            ref={triggerRef}
            type="button"
            aria-label="Message actions"
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className={styles.menu}
            align="end"
            sideOffset={4}
            onCloseAutoFocus={(event) => {
              if (dialog) event.preventDefault()
            }}
          >
            {menuError ? (
              <DropdownMenu.Item disabled>{menuError}</DropdownMenu.Item>
            ) : !actions ? (
              <DropdownMenu.Item disabled>Loading actions...</DropdownMenu.Item>
            ) : actions.canInspect ? (
              <DropdownMenu.Item
                className={styles.item}
                onSelect={() => void inspect()}
              >
                Inspect removed message
              </DropdownMenu.Item>
            ) : actions.canRemove ? (
              <DropdownMenu.Item
                className={styles.item}
                onSelect={() => {
                  setCategory('')
                  setNote('')
                  setError(null)
                  setDialog('remove')
                }}
              >
                Remove message
              </DropdownMenu.Item>
            ) : (
              <DropdownMenu.Item disabled>
                No actions available.
              </DropdownMenu.Item>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <Dialog.Root
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null)
            setDetails(null)
            setNote('')
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={styles.overlay} />
          <Dialog.Content
            className={styles.dialog}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              triggerRef.current?.focus()
            }}
          >
            <Dialog.Title>
              {dialog === 'remove' ? 'Remove message' : 'Removed message'}
            </Dialog.Title>
            <Dialog.Description>
              {dialog === 'remove'
                ? 'Replace this message with a tombstone for everyone in this Chat room.'
                : 'Only current Chat moderators can inspect this retained content.'}
            </Dialog.Description>
            {dialog === 'remove' ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void remove()
                }}
              >
                <label>
                  Category
                  <select
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    required
                    disabled={busy}
                  >
                    <option value="" disabled>
                      Select a category
                    </option>
                    <option>Spam</option>
                    <option>Harassment</option>
                    <option>Other</option>
                  </select>
                </label>
                <label>
                  Private note
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    maxLength={2000}
                    required={category === 'Other'}
                    disabled={busy}
                  />
                </label>
                <p>
                  {category === 'Other'
                    ? 'Other requires a private note.'
                    : 'A private note is optional.'}
                </p>
                <button
                  type="submit"
                  disabled={
                    busy || !category || (category === 'Other' && !note.trim())
                  }
                >
                  {busy ? 'Removing...' : 'Confirm removal'}
                </button>
              </form>
            ) : busy ? (
              <p role="status">Loading removed message...</p>
            ) : details ? (
              <div>
                <p>
                  {details.profileName} #{details.authorTag}
                </p>
                <p>{details.content}</p>
                <p>Category: {details.category}</p>
                {details.note && <p>Private note: {details.note}</p>}
              </div>
            ) : null}
            {error && <p role="alert">{error}</p>}
            <Dialog.Close asChild>
              <button type="button">
                {dialog === 'remove' ? 'Cancel' : 'Close'}
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
