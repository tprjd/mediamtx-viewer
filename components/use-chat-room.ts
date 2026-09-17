'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { useChatSending, type ChatSubmission } from '@/components/use-chat-sending'
import { useChatRealtime } from '@/components/use-chat-realtime'
import { useChatRestriction } from '@/components/use-chat-restriction'
import {
  chatRequestBlocksSending,
  chatTranscriptEntryCount,
  chatMessageRevision,
  latestChatSequence,
  firstChatSequenceGap,
  mergeChatHistoryPages,
  mergeChatMessages,
} from '@/lib/chat-client-state'
import type {
  ChatHistoryPage,
  ChatModeratorRole,
  PublicChatMessage,
} from '@/lib/chat-types'

interface HistoryResponse extends Partial<ChatHistoryPage> {
  restoreGeneration?: string
  moderatorRole?: ChatModeratorRole
  error?: string
}

interface ChatAnnouncement {
  id: number
  text: string
}

const INITIAL_FIRST_ITEM_INDEX = 1_000_000_000

export function useChatRoom(channelSlug: string, isChatVisible: boolean) {
  const endpoint = `/api/channels/${encodeURIComponent(channelSlug)}/chat/messages`
  const timeout = useChatRestriction(channelSlug, isChatVisible)
  const [messages, setMessages] = useState<PublicChatMessage[]>([])
  const messagesRef = useRef<PublicChatMessage[]>([])
  const clearedThroughRef = useRef(0)
  const reconciliationRef = useRef<Promise<void> | null>(null)
  const pendingReconciliationRef = useRef<number | null>(null)
  const requestGenerationRef = useRef(0)
  const wasChatVisibleRef = useRef(isChatVisible)
  const [confirmedIds, setConfirmedIds] = useState<ReadonlySet<string>>(
    new Set(),
  )
  const [unavailable, setUnavailable] = useState(false)
  const [transcriptVisit, setTranscriptVisit] = useState(0)
  const [loading, setLoading] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [firstItemIndex, setFirstItemIndex] = useState(INITIAL_FIRST_ITEM_INDEX)
  const [atBottom, setAtBottom] = useState(true)
  const atBottomRef = useRef(true)
  const hasOlderHistoryRef = useRef(false)
  const [historyExhausted, setHistoryExhausted] = useState(false)
  const [loadingOlderHistory, setLoadingOlderHistory] = useState(false)
  const loadingOlderHistoryRef = useRef(false)
  const [announcement, setAnnouncement] = useState<ChatAnnouncement | null>(
    null,
  )
  const announcementIdRef = useRef(0)
  const historyCursorRef = useRef<string | null>(null)

  const updateAtBottomState = useCallback((nextAtBottom: boolean) => {
    atBottomRef.current = nextAtBottom
    setAtBottom(nextAtBottom)
    if (!nextAtBottom) setAnnouncement(null)
  }, [])

  const updateHistoryAvailability = useCallback((hasMore: boolean) => {
    hasOlderHistoryRef.current = hasMore
  }, [])

  const updateOlderHistoryLoading = useCallback((isLoading: boolean) => {
    loadingOlderHistoryRef.current = isLoading
    setLoadingOlderHistory(isLoading)
  }, [])

  const applyHistoryPageMetadata = useCallback(
    (page: Pick<HistoryResponse, 'hasMore' | 'cursor'>) => {
      const hasMore = page.hasMore === true
      const cursor = hasMore ? (page.cursor ?? null) : null
      historyCursorRef.current = cursor
      updateHistoryAvailability(hasMore)
      setHistoryExhausted(!hasMore)
    },
    [updateHistoryAvailability],
  )

  const resetRoomState = useCallback(() => {
    requestGenerationRef.current += 1
    reconciliationRef.current = null
    pendingReconciliationRef.current = null
    historyCursorRef.current = null
    updateOlderHistoryLoading(false)
    updateHistoryAvailability(false)
    setHistoryExhausted(false)
    updateAtBottomState(true)
    setLoading(messagesRef.current.length === 0)
    setAccessDenied(false)
    setError(null)
    setFirstItemIndex(INITIAL_FIRST_ITEM_INDEX)
    setAnnouncement(null)
  }, [
    updateAtBottomState,
    updateHistoryAvailability,
    updateOlderHistoryLoading,
  ])

  const restoreGenerationRef = useRef<string | undefined>(undefined)
  const [restoreRevision, setRestoreRevision] = useState(0)
  const replaceHistoryRef = useRef(false)
  const reloadHistory = useCallback(() => {
    clearedThroughRef.current = 0
    replaceHistoryRef.current = true
    resetRoomState()
    setRestoreRevision((value) => value + 1)
  }, [resetRoomState])

  const announceMessage = useCallback((message: PublicChatMessage) => {
    if (message.removed) return
    announcementIdRef.current += 1
    setAnnouncement({
      id: announcementIdRef.current,
      text: `${message.profileName}: ${message.content}`,
    })
  }, [])

  const confirmMessages = useCallback((incoming: PublicChatMessage[]) => {
    setConfirmedIds(
      (current) =>
        new Set([
          ...current,
          ...incoming.flatMap(({ id, submissionId }) =>
            submissionId ? [id, submissionId] : [id],
          ),
        ]),
    )
  }, [])

  const applyHistoryClear = useCallback((clearedThrough: number, restoreGeneration?: string) => {
    if (restoreGeneration !== undefined) {
      if (restoreGenerationRef.current !== undefined && restoreGeneration !== restoreGenerationRef.current) return
      restoreGenerationRef.current = restoreGeneration
    }
    if (!Number.isSafeInteger(clearedThrough) || clearedThrough <= clearedThroughRef.current) return
    clearedThroughRef.current = clearedThrough
    confirmMessages(messagesRef.current.filter(message => message.sequence <= clearedThrough))
    messagesRef.current = messagesRef.current.filter(message => message.sequence > clearedThrough)
    setMessages(messagesRef.current)
    setAnnouncement(null)
    historyCursorRef.current = null
    updateHistoryAvailability(false)
    setHistoryExhausted(true)
    setFirstItemIndex(INITIAL_FIRST_ITEM_INDEX)
    setTranscriptVisit(visit => visit + 1)
  }, [confirmMessages, updateHistoryAvailability])

  useEffect(() => {
    if (timeout.restoreGeneration === restoreGenerationRef.current && timeout.clearedThrough !== undefined) {
      applyHistoryClear(timeout.clearedThrough)
    }
  }, [applyHistoryClear, timeout.clearedThrough, timeout.restoreGeneration])

  const checkAvailability = useCallback((response: Response) => {
    if (chatRequestBlocksSending(response.status)) setUnavailable(true)
    else if (response.ok) setUnavailable(false)
  }, [])

  const mergeMessages = useCallback((incoming: PublicChatMessage[]) => {
    incoming = incoming.filter(message => message.sequence > clearedThroughRef.current)
    if (incoming.some((message) => message.removed)) setAnnouncement(null)
    const previous = messagesRef.current
    const knownIds = new Set(previous.map(({ id }) => id))
    const merged = mergeChatMessages(previous, incoming)
    messagesRef.current = merged
    setMessages(merged)
    return {
      added: incoming.filter(({ id }) => !knownIds.has(id)),
      merged,
    }
  }, [])

  const mergeAndAnnounceMessage = useCallback(
    (message: PublicChatMessage) => {
      if (message.sequence <= clearedThroughRef.current) confirmMessages([message])
      const { added } = mergeMessages([message])
      if (isChatVisible && atBottomRef.current && added.length > 0) {
        announceMessage(message)
      }
      return added
    },
    [announceMessage, confirmMessages, isChatVisible, mergeMessages],
  )

  const mergeOlderPage = useCallback(
    (older: PublicChatMessage[], historyEnds: boolean) => {
      older = older.filter(message => message.sequence > clearedThroughRef.current)
      if (older.some((message) => message.removed)) setAnnouncement(null)
      const previous = messagesRef.current
      const merged = mergeChatHistoryPages(previous, older)
      const previousEntryCount = chatTranscriptEntryCount(previous, false)
      const nextEntryCount = chatTranscriptEntryCount(merged, historyEnds)
      const addedEntryCount = nextEntryCount - previousEntryCount
      messagesRef.current = merged
      setMessages(merged)
      if (addedEntryCount > 0) {
        setFirstItemIndex((current) => current - addedEntryCount)
      }
      return merged
    },
    [],
  )

  const reconcile = useCallback(
    (afterSequence?: number) => {
      const requestedAfter =
        afterSequence ?? latestChatSequence(messagesRef.current)
      pendingReconciliationRef.current =
        pendingReconciliationRef.current === null
          ? requestedAfter
          : Math.min(pendingReconciliationRef.current, requestedAfter)
      if (reconciliationRef.current) return
      const requestGeneration = requestGenerationRef.current
      const work = (async () => {
        while (pendingReconciliationRef.current !== null) {
          let after = pendingReconciliationRef.current
          pendingReconciliationRef.current = null
          let hasMore = true
          while (hasMore) {
            if (requestGeneration !== requestGenerationRef.current) return
            const response = await fetch(`${endpoint}?after=${after}`, {
              cache: 'no-store',
            })
            if (requestGeneration !== requestGenerationRef.current) return
            checkAvailability(response)
            const result = (await response.json()) as HistoryResponse
            if (requestGeneration !== requestGenerationRef.current) return
            if (!response.ok) {
              throw new Error(result.error ?? 'Could not reconcile Chat.')
            }
            if (
              restoreGenerationRef.current &&
              result.restoreGeneration &&
              result.restoreGeneration !== restoreGenerationRef.current
            ) {
              reloadHistory()
              return
            }
            const incoming = result.messages ?? []
            if ((result.clearedThrough ?? 0) < clearedThroughRef.current) return
            applyHistoryClear(result.clearedThrough ?? 0)
            setError(null)
            mergeMessages(incoming)
            confirmMessages(incoming)
            after = Math.max(after, latestChatSequence(incoming))
            hasMore = result.hasMore === true && incoming.length > 0
          }
        }
      })()
        .catch((reconcileError: unknown) => {
          if (requestGeneration !== requestGenerationRef.current) return
          setError(
            reconcileError instanceof Error
              ? reconcileError.message
              : 'Could not reconcile Chat.',
          )
        })
        .finally(() => {
          if (requestGeneration === requestGenerationRef.current) {
            reconciliationRef.current = null
          }
        })
      reconciliationRef.current = work
    },
    [
      applyHistoryClear,
      checkAvailability,
      confirmMessages,
      endpoint,
      mergeMessages,
      reloadHistory,
    ],
  )

  const receiveMessage = useCallback(
    (message: PublicChatMessage) => {
      if (!isChatVisible) return
      const lastSequence = latestChatSequence(messagesRef.current)
      mergeAndAnnounceMessage(message)
      confirmMessages([message])
      if (
        !loading &&
        lastSequence !== undefined &&
        chatMessageRevision(message) > lastSequence + 1
      ) {
        reconcile(lastSequence)
      }
    },
    [confirmMessages, isChatVisible, loading, mergeAndAnnounceMessage, reconcile],
  )

  const loadOlderHistory = useCallback(async () => {
    const cursor = historyCursorRef.current
    if (
      !cursor ||
      !hasOlderHistoryRef.current ||
      loadingOlderHistoryRef.current
    ) {
      return
    }
    const requestGeneration = requestGenerationRef.current
    updateOlderHistoryLoading(true)
    setError(null)
    try {
      const response = await fetch(
        `${endpoint}?before=${encodeURIComponent(cursor)}`,
        { cache: 'no-store' },
      )
      if (requestGeneration !== requestGenerationRef.current) return
      checkAvailability(response)
      const result = (await response.json()) as HistoryResponse
      if (requestGeneration !== requestGenerationRef.current) return
      if (!response.ok) {
        throw new Error(result.error ?? 'Could not load Chat history.')
      }
      if (
        restoreGenerationRef.current &&
        result.restoreGeneration &&
        result.restoreGeneration !== restoreGenerationRef.current
      ) {
        reloadHistory()
        return
      }
      if ((result.clearedThrough ?? 0) < clearedThroughRef.current) return
      applyHistoryClear(result.clearedThrough ?? 0)
      mergeOlderPage(result.messages ?? [], result.hasMore !== true)
      applyHistoryPageMetadata(result)
    } catch (historyError: unknown) {
      if (requestGeneration !== requestGenerationRef.current) return
      setError(
        historyError instanceof Error
          ? historyError.message
          : 'Could not load Chat history.',
      )
    } finally {
      if (requestGeneration !== requestGenerationRef.current) return
      updateOlderHistoryLoading(false)
    }
  }, [
    applyHistoryClear,
    applyHistoryPageMetadata,
    checkAvailability,
    endpoint,
    mergeOlderPage,
    reloadHistory,
    updateOlderHistoryLoading,
  ])

  useEffect(() => {
    if (!isChatVisible) {
      if (wasChatVisibleRef.current) {
        wasChatVisibleRef.current = false
        requestGenerationRef.current += 1
        reconciliationRef.current = null
        pendingReconciliationRef.current = null
        setAnnouncement(null)
      }
      return
    }
    if (wasChatVisibleRef.current) return
    wasChatVisibleRef.current = true
    resetRoomState()
  }, [isChatVisible, resetRoomState])

  const realtimeState = useChatRealtime({
    active: isChatVisible,
    channelSlug,
    onMessage: receiveMessage,
    onHistoryCleared: applyHistoryClear,
    onRecoveryFailed: reconcile,
    onRestored: reloadHistory,
    onRestrictionChanged: timeout.refresh,
  })

  useEffect(() => {
    if (!isChatVisible) return

    const requestGeneration = requestGenerationRef.current
    const controller = new AbortController()
    const latestRequestSequence = latestChatSequence(messagesRef.current)
    const replaceRestoredHistory = replaceHistoryRef.current
    const existingIds = new Set(messagesRef.current.map(({ id }) => id))
    void fetch(endpoint, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (requestGeneration !== requestGenerationRef.current) return
        checkAvailability(response)
        const result = (await response.json()) as HistoryResponse
        if (requestGeneration !== requestGenerationRef.current) return
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true)
        }
        if (!response.ok)
          throw new Error(result.error ?? 'Could not load Chat.')
        const incoming = result.messages ?? []
        if (restoreGenerationRef.current !== undefined && result.restoreGeneration !== restoreGenerationRef.current) {
          clearedThroughRef.current = 0
          messagesRef.current = []
        }
        if ((result.clearedThrough ?? 0) < clearedThroughRef.current) return
        applyHistoryClear(result.clearedThrough ?? 0)
        restoreGenerationRef.current = result.restoreGeneration
        // Reopening starts with the latest page. Keep loaded history until it succeeds.
        messagesRef.current = replaceRestoredHistory
          ? messagesRef.current.filter(({ id }) => !existingIds.has(id))
          : messagesRef.current.filter(
              (message) =>
                (message.removed &&
                  incoming.some(({ id }) => id === message.id)) ||
                chatMessageRevision(message) >
                  Math.max(latestRequestSequence, latestChatSequence(incoming)),
            )
        replaceHistoryRef.current = false
        const { merged } = mergeMessages(incoming)
        confirmMessages(incoming)
        setError(null)
        setTranscriptVisit((visit) => visit + 1)
        applyHistoryPageMetadata(result)
        const gap = firstChatSequenceGap(merged)
        if (gap !== null) reconcile(gap)
      })
      .catch((loadError: unknown) => {
        if (
          controller.signal.aborted ||
          requestGeneration !== requestGenerationRef.current
        ) {
          return
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Could not load Chat.',
        )
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          requestGeneration === requestGenerationRef.current
        ) {
          setLoading(false)
        }
      })

    return () => controller.abort()
  }, [
    applyHistoryClear,
    applyHistoryPageMetadata,
    checkAvailability,
    confirmMessages,
    endpoint,
    isChatVisible,
    mergeMessages,
    reconcile,
    restoreRevision,
  ])

  const sending = useChatSending({
    endpoint,
    connected: realtimeState === 'connected',
    confirmedIds,
    unavailable: unavailable || accessDenied || loading || timeout.blocked,
    onUnavailable: () => setUnavailable(true),
    onRestricted: () => void timeout.refresh(),
    onAccepted: mergeAndAnnounceMessage,
  })
  const delayed = sending.submissions.some((entry) => entry.state === 'delayed')
  const previousRealtimeState = useRef(realtimeState)
  const delayedAfter = Math.min(
    ...sending.submissions.flatMap((entry) =>
      entry.message ? [entry.message.sequence - 1] : [],
    ),
  )
  useEffect(() => {
    // A connection can complete before the initial history request. Wait for its
    // cursor so the first connection does not fetch the entire retained room.
    if (loading) return
    if (
      realtimeState === 'connected' &&
      previousRealtimeState.current !== 'connected'
    ) {
      // Include accepted sends whose publications were lost during the outage.
      reconcile(Math.min(delayedAfter, latestChatSequence(messagesRef.current)))
    }
    previousRealtimeState.current = realtimeState
  }, [delayedAfter, loading, realtimeState, reconcile])

  useEffect(() => {
    if (!isChatVisible || !unavailable) return
    const timer = setInterval(() => reconcile(0), 3_000)
    return () => clearInterval(timer)
  }, [isChatVisible, unavailable, reconcile])

  const sendDisabled =
    loading ||
    sending.sending ||
    accessDenied ||
    unavailable ||
    timeout.blocked ||
    sending.remainingSeconds > 0

  const moderatorRole = unavailable || accessDenied ? null : timeout.moderatorRole

  return {
    loading,
    transcriptKey: transcriptVisit,
    transcript: {
      channelSlug,
      moderatorRole,
      onRemoved: receiveMessage,
      atBottom,
      firstItemIndex,
      historyExhausted,
      loadingOlderHistory,
      messages: messages.map((message) =>
        message.removed || !timeout.authorities
          ? message
          : {
              ...message,
              badges:
                timeout.authorities.find(
                  (author) => author.authorTag === message.authorTag,
                )?.badges ?? [],
            },
      ),
      onAtBottomChange: updateAtBottomState,
      onLoadOlder: () => void loadOlderHistory(),
      realtimeState,
      submissions: sending.submissions,
      onRetry: (submission: ChatSubmission) => void sending.send(submission),
      retryDisabled: sendDisabled,
    },
    composer: {
      draft: sending.draft,
      setDraft: sending.setDraft,
      send: () => void sending.send(),
      disabled: loading || accessDenied || unavailable || timeout.blocked,
      sendDisabled: sendDisabled || !sending.draft.trim(),
      canFocus: isChatVisible && !loading && !unavailable && !timeout.blocked,
    },
    moderation: { role: moderatorRole, onCleared: applyHistoryClear },
    status: {
      unavailable,
      reconnecting: realtimeState !== 'connected' || delayed,
      delayed,
      error: sending.error || error,
      retrySeconds: sending.remainingSeconds,
      restriction: timeout.restriction,
      restrictionSeconds: timeout.remainingSeconds,
      storageLimited: timeout.storageLimited,
      restrictionCheckFailed: timeout.failed,
    },
    announcement,
  }
}
