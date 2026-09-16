'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { useCallback, useEffect, useState } from 'react'
import type { listChatModerationRecords } from '@/lib/chat-moderation'
import dialogStyles from '@/components/chat-message-actions.module.css'
import styles from '@/components/admin/chat-moderation-history.module.css'

type RecordPage = ReturnType<typeof listChatModerationRecords>
const endpoint = '/api/admin/chat/moderation'
const actionNames = {
  ban: 'Chat ban',
  timeout: 'Chat timeout',
  reversal: 'Reversal',
  message_removal: 'Message removal',
}

export function ChatModerationHistory() {
  const [page, setPage] = useState<RecordPage | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [previous, setPrevious] = useState<Array<string | null>>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      try {
        const response = await fetch(
          endpoint + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''),
          { cache: 'no-store', signal },
        )
        const result = await response.json()
        if (!response.ok)
          throw new Error(
            result.error ?? 'Could not load Chat moderation records.',
          )
        if (signal?.aborted) return
        setPage(result)
        setError(null)
      } catch (error) {
        if (signal?.aborted) return
        setError(
          error instanceof Error ? error.message : 'Chat is unavailable.',
        )
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [cursor],
  )
  useEffect(() => {
    const controller = new AbortController()
    const initial = setTimeout(() => void load(controller.signal), 0)
    return () => {
      clearTimeout(initial)
      controller.abort()
    }
  }, [load])
  async function clear() {
    setClearing(true)
    try {
      const response = await fetch(endpoint, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(
          result.error ?? 'Could not clear Chat moderation records.',
        )
      setPrevious([])
      setCursor(null)
      setPage({ records: [], cursor: null })
      setError(null)
      setConfirmOpen(false)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Chat is unavailable.')
    } finally {
      setClearing(false)
    }
  }
  return (
    <section
      className={styles.history}
      aria-label="Chat moderation history"
      aria-busy={loading}
    >
      <div className={styles.controls}>
        <button
          type="button"
          disabled={loading || clearing}
          onClick={() => void load()}
        >
          Refresh records
        </button>
        <Dialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
          <Dialog.Trigger asChild>
            <button
              type="button"
              disabled={loading || clearing || !page?.records.length}
            >
              Clear Chat moderation records
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className={dialogStyles.overlay} />
            <Dialog.Content className={dialogStyles.dialog}>
              <Dialog.Title>Clear Chat moderation records?</Dialog.Title>
              <Dialog.Description>
                This permanently deletes all Chat moderation records across all
                rooms. Active Chat timeouts and Chat bans remain in effect.
              </Dialog.Description>
              <button
                type="button"
                disabled={clearing}
                onClick={() => void clear()}
              >
                {clearing ? 'Clearing...' : 'Confirm clear'}
              </button>
              <Dialog.Close asChild>
                <button type="button" disabled={clearing}>
                  Cancel
                </button>
              </Dialog.Close>
              {error && <p role="alert">{error}</p>}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Loading records...</p>}
      {!loading && page?.records.length === 0 && (
        <p>No Chat moderation records.</p>
      )}
      {Boolean(page?.records.length) && (
        <div className={styles.tableScroll}>
          <table>
            <caption>Chat moderation records across all rooms</caption>
            <thead>
              <tr>
                {[
                  'Action',
                  'Category',
                  'Actor',
                  'Target',
                  'Room',
                  'State',
                  'Created',
                  'Expires',
                  'Reversed',
                ].map((label) => (
                  <th key={label} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page?.records.map((record) => (
                <tr key={record.id}>
                  <td>{actionNames[record.action]}</td>
                  <td>{record.category}</td>
                  <td>{record.actor}</td>
                  <td>{record.target}</td>
                  <td>
                    {record.room}
                    {record.channelSlug && <small>/{record.channelSlug}</small>}
                  </td>
                  <td>{record.state}</td>
                  {[record.createdAt, record.expiresAt, record.reversedAt].map(
                    (time, index) => (
                      <td key={index}>
                        {time ? (
                          <time dateTime={time}>
                            {new Date(time).toLocaleString()}
                          </time>
                        ) : index === 1 && record.action === 'ban' ? (
                          'Indefinite'
                        ) : (
                          '—'
                        )}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className={styles.controls}>
        <button
          type="button"
          disabled={loading || clearing || !previous.length}
          onClick={() => {
            setCursor(previous.at(-1) ?? null)
            setPrevious(previous.slice(0, -1))
          }}
        >
          Previous page
        </button>
        <button
          type="button"
          disabled={loading || clearing || !page?.cursor}
          onClick={() => {
            setPrevious([...previous, cursor])
            setCursor(page?.cursor ?? null)
          }}
        >
          Next page
        </button>
      </div>
    </section>
  )
}
