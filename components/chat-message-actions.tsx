'use client'

import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  Ban,
  Eye,
  MoreHorizontal,
  ShieldCheck,
  Timer,
  Trash2,
  X,
} from 'lucide-react'
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
    canTimeout: boolean
  } | null>(null)
  const [menuError, setMenuError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<
    'remove' | 'timeout' | 'ban' | 'inspect' | null
  >(null)
  const [durationMinutes, setDurationMinutes] = useState('10')
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

  function openAction(action: 'remove' | 'timeout' | 'ban') {
    setCategory('')
    setNote('')
    setDurationMinutes('10')
    setError(null)
    setDialog(action)
  }

  async function moderate() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(
        dialog === 'timeout' || dialog === 'ban'
          ? endpoint.replace(/\/removal$/, `/${dialog}`)
          : endpoint,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            category,
            note,
            ...(dialog === 'timeout'
              ? { durationMinutes: Number(durationMinutes) }
              : {}),
          }),
        },
      )
      const result = await response.json()
      if (!response.ok)
        throw new Error(
          result.error ?? 'Could not apply the Chat moderation action.',
        )
      if (dialog === 'timeout' || dialog === 'ban')
        result.messages.forEach(onRemoved)
      else onRemoved(result.message)
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
            className={`${styles.menu} ${styles.actionMenu}`}
            align="end"
            sideOffset={4}
            onCloseAutoFocus={(event) => {
              if (dialog) event.preventDefault()
            }}
          >
            {!message.removed && (
              <DropdownMenu.Label className={styles.menuLabel}>
                {message.profileName} <span>#{message.authorTag}</span>
              </DropdownMenu.Label>
            )}
            {menuError ? (
              <DropdownMenu.Item disabled>{menuError}</DropdownMenu.Item>
            ) : !actions ? (
              <DropdownMenu.Item disabled>Loading actions...</DropdownMenu.Item>
            ) : (
              <>
                {actions.canInspect && (
                  <DropdownMenu.Item onSelect={() => void inspect()}>
                    <Eye size={15} aria-hidden="true" />
                    Inspect removed message
                  </DropdownMenu.Item>
                )}
                {actions.canRemove && (
                  <DropdownMenu.Item onSelect={() => openAction('remove')}>
                    <Trash2 size={15} aria-hidden="true" />
                    Remove message
                  </DropdownMenu.Item>
                )}
                {actions.canTimeout && (
                  <DropdownMenu.Item onSelect={() => openAction('timeout')}>
                    <Timer size={15} aria-hidden="true" />
                    Apply Chat timeout
                  </DropdownMenu.Item>
                )}
                {actions.canTimeout && (
                  <>
                    <DropdownMenu.Separator className={styles.menuSeparator} />
                    <DropdownMenu.Item
                      className={styles.dangerItem}
                      onSelect={() => openAction('ban')}
                    >
                      <Ban size={15} aria-hidden="true" />
                      Apply Chat ban
                    </DropdownMenu.Item>
                  </>
                )}
                {!actions.canInspect &&
                  !actions.canRemove &&
                  !actions.canTimeout && (
                    <DropdownMenu.Item disabled>
                      No actions available.
                    </DropdownMenu.Item>
                  )}
              </>
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
            data-action={dialog}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              triggerRef.current?.focus()
            }}
          >
            <div className={styles.dialogHeading}>
              <span className={styles.dialogContext}>
                <ShieldCheck size={14} aria-hidden="true" />
                Moderation
              </span>
              <Dialog.Close asChild>
                <button type="button" aria-label="Dismiss moderation dialog">
                  <X size={18} aria-hidden="true" />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Title>
              {dialog === 'ban'
                ? 'Apply Chat ban'
                : dialog === 'timeout'
                  ? 'Apply Chat timeout'
                  : dialog === 'remove'
                    ? 'Remove message'
                    : 'Removed message'}
            </Dialog.Title>
            <Dialog.Description>
              {dialog === 'timeout' || dialog === 'ban'
                ? 'Stop this participant from sending and remove their messages from the previous ten minutes. They can still read Chat and watch the Channel.'
                : dialog === 'remove'
                  ? 'Replace this message with “Message removed” for everyone in this Chat room.'
                  : 'Only current Chat moderators can inspect this retained content.'}
            </Dialog.Description>
            {!message.removed && (
              <div className={styles.targetMessage}>
                <strong>
                  {message.profileName} <span>#{message.authorTag}</span>
                </strong>
                <p>{message.content}</p>
              </div>
            )}
            {dialog === 'remove' || dialog === 'timeout' || dialog === 'ban' ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void moderate()
                }}
              >
                <div className={styles.fieldRow}>
                  {dialog === 'timeout' && (
                    <label>
                      Duration
                      <select
                        value={durationMinutes}
                        onChange={(event) =>
                          setDurationMinutes(event.target.value)
                        }
                        disabled={busy}
                      >
                        <option value="10">10 minutes</option>
                        <option value="60">1 hour</option>
                        <option value="1440">24 hours</option>
                      </select>
                    </label>
                  )}
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
                </div>
                <label>
                  <span className={styles.fieldLabel}>
                    Private note{' '}
                    <small>
                      {category === 'Other' ? 'Required for Other' : 'Optional'}
                    </small>
                  </span>
                  <textarea
                    aria-label="Private note"
                    placeholder="Context for other moderators"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    maxLength={2000}
                    required={category === 'Other'}
                    disabled={busy}
                  />
                </label>
                {error && (
                  <p className={styles.dialogError} role="alert">
                    {error}
                  </p>
                )}
                <div className={styles.dialogButtons}>
                  <Dialog.Close asChild>
                    <button type="button">Cancel</button>
                  </Dialog.Close>
                  <button
                    className={styles.confirmAction}
                    type="submit"
                    disabled={
                      busy ||
                      !category ||
                      (category === 'Other' && !note.trim())
                    }
                  >
                    {busy
                      ? 'Applying...'
                      : dialog === 'ban'
                        ? 'Confirm ban'
                        : dialog === 'timeout'
                          ? 'Confirm timeout'
                          : 'Confirm removal'}
                  </button>
                </div>
              </form>
            ) : busy ? (
              <p role="status">Loading removed message...</p>
            ) : details ? (
              <div className={styles.inspectedMessage}>
                <p>
                  {details.profileName} #{details.authorTag}
                </p>
                <p>{details.content}</p>
                <p>Category: {details.category}</p>
                {details.note && <p>Private note: {details.note}</p>}
              </div>
            ) : null}
            {dialog === 'inspect' && (
              <>
                {error && (
                  <p className={styles.dialogError} role="alert">
                    {error}
                  </p>
                )}
                <div className={styles.dialogButtons}>
                  <Dialog.Close asChild>
                    <button type="button">Close</button>
                  </Dialog.Close>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
