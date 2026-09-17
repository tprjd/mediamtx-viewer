'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Trash2 } from 'lucide-react'
import { useEffect, useEffectEvent, useState } from 'react'
import styles from '@/components/chat-message-actions.module.css'

export function ChatClearHistory({ channelSlug, onCleared }: {
  channelSlug: string
  onCleared: (clearedThrough: number, restoreGeneration?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endpoint = `/api/channels/${encodeURIComponent(channelSlug)}/chat/history`
  const applyCleared = useEffectEvent(onCleared)

  useEffect(() => {
    if (!pending) return
    const controller = new AbortController()
    const timer = setInterval(async () => {
      try {
        const response = await fetch(endpoint, { cache: 'no-store', signal: controller.signal })
        const state = await response.json()
        if (controller.signal.aborted) return
        if (!response.ok) throw new Error(state.error ?? 'Could not check clearing status.')
        applyCleared(state.clearedThrough, state.restoreGeneration)
        setError(null)
        if (!state.clearPending) { setPending(false); setOpen(false) }
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Could not check clearing status.')
      }
    }, 1_000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [endpoint, pending])

  async function clear() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(endpoint, {
        method: 'DELETE', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      })
      const state = await response.json()
      if (!response.ok) throw new Error(state.error ?? 'Could not clear Chat history.')
      onCleared(state.clearedThrough, state.restoreGeneration)
      setPending(state.clearPending)
      if (!state.clearPending) setOpen(false)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not clear Chat history.')
    } finally { setBusy(false) }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className={styles.headerButton} aria-label="Clear Chat history">
          <Trash2 size={17} aria-hidden="true" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.dialog}>
          <Dialog.Title>Clear Chat history</Dialog.Title>
          <Dialog.Description>
            Delete all stored Chat messages in Channel <strong>{channelSlug}</strong>, including removed message content.
            Restrictions and moderation records remain. Existing backups may contain these messages;
            restoring an older backup can bring them back.
          </Dialog.Description>
          {pending && <p role="status">Messages deleted. Updating connected participants… You can close this dialog.</p>}
          {error && <p className={styles.dialogError} role="alert">{error}</p>}
          <div className={styles.dialogButtons}>
            <Dialog.Close asChild><button type="button">{pending ? 'Close' : 'Cancel'}</button></Dialog.Close>
            <button className={styles.confirmAction} type="button" onClick={() => void clear()} disabled={busy || pending}>
              {busy || pending ? 'Clearing…' : 'Confirm clearing'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
