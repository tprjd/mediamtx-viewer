'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { useCallback, useEffect, useState } from 'react'
import type { listActiveChatRestrictions } from '@/lib/chat-moderation'
import styles from '@/components/chat-message-actions.module.css'

type Restriction = ReturnType<typeof listActiveChatRestrictions>[number]

export function ChatRestrictionsPanel({
  channelSlug,
}: {
  channelSlug: string
}) {
  const [open, setOpen] = useState(false)
  const [restrictions, setRestrictions] = useState<Restriction[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const endpoint = `/api/channels/${encodeURIComponent(channelSlug)}/chat/restrictions`
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch(endpoint, { cache: 'no-store', signal })
        const result = await response.json()
        if (!response.ok)
          throw new Error(result.error ?? 'Could not load Chat restrictions.')
        if (signal?.aborted) return
        setRestrictions(result.restrictions)
        setError(null)
      } catch (error) {
        if (signal?.aborted) return
        setError(
          error instanceof Error ? error.message : 'Chat is unavailable.',
        )
      }
    },
    [endpoint],
  )
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const initial = setTimeout(() => void refresh(controller.signal), 0)
    const timer = setInterval(() => void refresh(controller.signal), 5_000)
    return () => {
      clearTimeout(initial)
      controller.abort()
      clearInterval(timer)
    }
  }, [open, refresh])
  async function reverse(restriction: Restriction) {
    setBusy(restriction.id)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ restrictionId: restriction.id }),
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.error ?? 'Could not lift the Chat restriction.')
      await refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Chat is unavailable.')
    } finally {
      setBusy(null)
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button">Active Chat restrictions</button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.dialog}>
          <Dialog.Title>Active Chat restrictions</Dialog.Title>
          <Dialog.Description>
            Review Chat timeouts and Chat bans in this room. Lifting a
            restriction restores sending.
          </Dialog.Description>
          {error && <p role="alert">{error}</p>}
          {!error && restrictions.length === 0 && (
            <p>No active Chat restrictions.</p>
          )}
          <ul>
            {restrictions.map((restriction) => (
              <li key={restriction.id}>
                <p>
                  {restriction.target} #{restriction.authorTag}
                </p>
                <p>
                  Chat {restriction.action}: {restriction.category}.{' '}
                  {restriction.expiresAt ? (
                    <>
                      Expires{' '}
                      <time dateTime={restriction.expiresAt}>
                        {new Date(restriction.expiresAt).toLocaleString()}
                      </time>
                      .
                    </>
                  ) : (
                    'Indefinite.'
                  )}
                </p>
                <button
                  type="button"
                  disabled={
                    Boolean(busy) || !restriction.canReverse || Boolean(error)
                  }
                  onClick={() => void reverse(restriction)}
                >
                  {busy === restriction.id ? 'Lifting...' : 'Lift restriction'}
                </button>
                {!restriction.canReverse && (
                  <p>Only an administrator can lift this restriction.</p>
                )}
              </li>
            ))}
          </ul>
          <Dialog.Close asChild>
            <button type="button">Close</button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
