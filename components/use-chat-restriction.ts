'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'

const participantStateSchema = z.object({
  channelId: z.string(),
  restriction: z
    .object({
      category: z.enum(['Spam', 'Harassment', 'Other']),
      expiresAt: z.iso.datetime().nullable(),
    })
    .nullable(),
  moderatorRole: z.enum(['admin', 'owner']).nullable(),
  serverTime: z.iso.datetime(),
  authorities: z
    .array(
      z.object({
        authorTag: z.string(),
        badges: z.array(z.enum(['admin', 'owner'])),
      }),
    )
    .optional(),
})

export function useChatRestriction(channelSlug: string, active: boolean) {
  const [state, setState] = useState<z.infer<
    typeof participantStateSchema
  > | null>(null)
  const [checking, setChecking] = useState(true)
  const [failed, setFailed] = useState(false)
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const generation = useRef(0)
  const channelId = useRef<string | null>(null)
  const deadline = useRef(0)

  const refresh = useCallback(
    async (changedChannelId?: string, background = false) => {
      if (
        !active ||
        (changedChannelId &&
          channelId.current &&
          changedChannelId !== channelId.current)
      )
        return
      const request = ++generation.current
      if (!background) setChecking(true)
      try {
        const response = await fetch(
          `/api/channels/${encodeURIComponent(channelSlug)}/chat/state`,
          { cache: 'no-store', signal: AbortSignal.timeout(5_000) },
        )
        if (!response.ok)
          throw new Error('Could not load Chat restriction state.')
        const result = participantStateSchema.parse(await response.json())
        if (request !== generation.current) return
        channelId.current = result.channelId
        const duration = result.restriction?.expiresAt
          ? Math.max(
              0,
              Date.parse(result.restriction.expiresAt) -
                Date.parse(result.serverTime),
            )
          : 0
        deadline.current = performance.now() + duration
        setRemainingSeconds(Math.ceil(duration / 1_000))
        setState(result)
        setFailed(false)
      } catch {
        if (request === generation.current) setFailed(true)
      } finally {
        if (request === generation.current) setChecking(false)
      }
    },
    [active, channelSlug],
  )

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0)
    const poll = setInterval(() => void refresh(undefined, true), 5_000)
    return () => {
      clearInterval(poll)
      clearTimeout(timer)
      generation.current += 1
    }
  }, [refresh])

  useEffect(() => {
    if (!active || checking) return
    if (failed) {
      const timer = setTimeout(() => void refresh(), 3_000)
      return () => clearTimeout(timer)
    }
    if (!state?.restriction?.expiresAt) return
    const timer = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((deadline.current - performance.now()) / 1_000),
      )
      setRemainingSeconds(remaining)
      // Only the server can restore sending or moderation authority.
      if (!remaining) {
        clearInterval(timer)
        void refresh()
      }
    }, 250)
    return () => clearInterval(timer)
  }, [active, checking, failed, refresh, state])

  return {
    restriction: state?.restriction ?? null,
    authorities: state?.authorities,
    moderatorRole: !failed ? (state?.moderatorRole ?? null) : null,
    blocked: !state || checking || failed || Boolean(state.restriction),
    failed,
    remainingSeconds,
    refresh,
  }
}
