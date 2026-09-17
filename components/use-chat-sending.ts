'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  chatRequestBlocksSending,
  createChatSubmissionId,
} from '@/lib/chat-client-state'
import type { PublicChatMessage } from '@/lib/chat-types'

export interface ChatSubmission {
  key: string
  submissionId?: string
  error?: string
  content: string
  state: 'sending' | 'failed' | 'accepted' | 'delayed'
  acceptedAt?: number
  message?: PublicChatMessage
}

interface ChatSendingInput {
  endpoint: string
  connected: boolean
  confirmedIds: ReadonlySet<string>
  unavailable: boolean
  onUnavailable: () => void
  onAccepted: (message: PublicChatMessage) => void
  onRestricted: () => void
}

export function useChatSending({
  endpoint,
  connected,
  confirmedIds,
  unavailable,
  onUnavailable,
  onAccepted,
  onRestricted,
}: ChatSendingInput) {
  const [draft, setDraft] = useState('')
  const [submissions, setSubmissions] = useState<ChatSubmission[]>([])
  const [retryAt, setRetryAt] = useState(0)
  const [now, setNow] = useState(0)
  const deliveryConnected = useRef(connected)
  const inFlight = useRef(false)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!retryAt) return
    const timer = setInterval(() => {
      const time = Date.now()
      setNow(time)
      if (time >= retryAt) {
        setRetryAt(0)
        clearInterval(timer)
      }
    }, 200)
    return () => clearInterval(timer)
  }, [retryAt])

  useEffect(() => {
    deliveryConnected.current = connected
  }, [connected])

  useEffect(() => {
    const awaiting = submissions.filter(
      (entry) =>
        entry.state === 'accepted' &&
        entry.message &&
        !confirmedIds.has(entry.message.id),
    )
    if (!awaiting.length) return
    const deadline = Math.min(
      ...awaiting.map((entry) => entry.acceptedAt! + 3_000),
    )
    const timer = setTimeout(
      () => {
        setSubmissions((current) =>
          current.map((entry) =>
            entry.state === 'accepted' &&
            (!connected || Date.now() >= entry.acceptedAt! + 3_000)
              ? { ...entry, state: 'delayed' }
              : entry,
          ),
        )
      },
      connected ? Math.max(0, deadline - Date.now()) : 0,
    )
    return () => clearTimeout(timer)
  }, [connected, confirmedIds, submissions])

  async function send(retry?: ChatSubmission) {
    if (inFlight.current || unavailable || Date.now() < retryAt) return
    const content = retry?.content ?? draft
    if (!content.trim()) return
    const submission = retry ??
      submissions.find(
        (entry) => entry.state === 'failed' && entry.content === content,
      ) ?? {
        key: crypto.randomUUID(),
        content,
        state: 'sending' as const,
      }
    inFlight.current = true
    setSending(true)
    setSubmissions((current) => [
      ...current.filter(
        (entry) =>
          entry.key !== submission.key &&
          !confirmedIds.has(entry.submissionId ?? '') &&
          (!entry.message || !confirmedIds.has(entry.message.id)),
      ),
      { ...submission, state: 'sending' },
    ])
    try {
      const submissionId =
        submission.submissionId ??
        (await createChatSubmissionId(submission.key))
      setSubmissions((current) =>
        current.map((entry) =>
          entry.key === submission.key ? { ...entry, submissionId } : entry,
        ),
      )
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content: submission.content,
          clientIdempotencyKey: submission.key,
        }),
      })
      // A storage failure must disable sends even if a proxy replaced the JSON body.
      if (chatRequestBlocksSending(response.status)) onUnavailable()
      if (response.status === 403) onRestricted()
      const result = (await response.json()) as {
        message?: PublicChatMessage
        error?: string
        retryAt?: string
        cleared?: boolean
      }
      if (response.status === 409 && result.cleared) {
        setSubmissions(current => current.filter(entry => entry.key !== submission.key))
        setDraft(current => current === submission.content ? '' : current)
        return
      }
      if (response.status === 429 && result.retryAt) {
        const time = Date.parse(result.retryAt)
        if (Number.isFinite(time)) {
          setNow(Date.now())
          setRetryAt(time)
        }
      }
      if (!response.ok || !result.message)
        throw new Error(result.error ?? 'Could not send the message.')
      const message = result.message
      onAccepted(message)
      setSubmissions((current) =>
        current.map((entry) =>
          entry.key === submission.key
            ? {
                ...entry,
                message,
                acceptedAt: Date.now(),
                state: deliveryConnected.current ? 'accepted' : 'delayed',
              }
            : entry,
        ),
      )
      setDraft((current) => (current === submission.content ? '' : current))
    } catch (failure) {
      setSubmissions((current) =>
        current.map((entry) =>
          entry.key === submission.key
            ? {
                ...entry,
                state: 'failed',
                error:
                  failure instanceof Error
                    ? failure.message
                    : 'Could not send the message.',
              }
            : entry,
        ),
      )
    } finally {
      inFlight.current = false
      setSending(false)
    }
  }

  const [previousConfirmedIds, setPreviousConfirmedIds] = useState(confirmedIds)
  if (previousConfirmedIds !== confirmedIds) {
    setPreviousConfirmedIds(confirmedIds)
    const confirmed = submissions.find(
      (entry) =>
        confirmedIds.has(entry.submissionId ?? '') && entry.content === draft,
    )
    if (confirmed) setDraft('')
  }

  // Publications can arrive before the HTTP response.
  const pending = useMemo(
    () =>
      submissions.filter(
        (entry) =>
          !confirmedIds.has(entry.submissionId ?? '') &&
          (!entry.message || !confirmedIds.has(entry.message.id)),
      ),
    [submissions, confirmedIds],
  )
  return {
    draft,
    setDraft,
    error: pending.find((entry) => entry.state === 'failed')?.error ?? null,
    sending,
    send,
    submissions: pending,
    remainingSeconds: Math.max(0, Math.ceil((retryAt - now) / 1_000)),
  }
}
