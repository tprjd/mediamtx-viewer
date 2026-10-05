'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { decideViewingAction, readNotificationsAction } from '@/app/account/channel/viewing-actions'
import type { AccountNotification } from '@/lib/viewing-requests'
import { playNotificationTone } from '@/lib/notification-sound'

export type NotificationInbox = { notifications: AccountNotification[]; unread: number; sound: boolean }

function mergeNotifications(current: AccountNotification[], incoming: AccountNotification[]): AccountNotification[] {
  const items = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) items.set(item.id, item)
  return [...items.values()].sort((a, b) => b.id - a.id)
}

export function useNotificationInbox(userId: string, initial: NotificationInbox) {
  const [inbox, setInbox] = useState(initial)
  const [more, setMore] = useState(initial.notifications.length === 100)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const loaded = useRef(initial.notifications)
  const older = useRef<AccountNotification[]>([])
  const before = useRef(initial.notifications.at(-1)?.id)
  const cursorVersion = useRef(0)
  const latest = useRef(initial.notifications[0]?.id ?? 0)
  const lifetime = useRef(0)
  const requestVersion = useRef(0)
  const requests = useRef(new Set<AbortController>())
  const actionPending = useRef(false)
  const mutationPending = useRef(false)
  const router = useRouter()

  function receive(next: NotificationInbox) {
    if (next.notifications.length === 100 && !next.notifications.some((item) => loaded.current.some((old) => old.id === item.id))) {
      before.current = next.notifications.at(-1)!.id
      cursorVersion.current += 1
      setMore(true)
    }
    loaded.current = mergeNotifications(loaded.current, next.notifications)
    setInbox({ ...next, notifications: mergeNotifications(older.current, loaded.current) })
  }

  async function refresh(onReceive?: (next: NotificationInbox, current: () => boolean) => Promise<void>) {
    const generation = lifetime.current
    const version = ++requestVersion.current
    const current = () => lifetime.current === generation && requestVersion.current === version
    const controller = new AbortController()
    requests.current.add(controller)
    try {
      const response = await fetch('/api/notifications', { cache: 'no-store', signal: controller.signal })
      if (!current()) return null
      if (!response.ok) return false
      const next: NotificationInbox = await response.json()
      if (!current()) return null
      await onReceive?.(next, current)
      if (!current()) return null
      receive(next)
      return true
    } catch (error) {
      if (!current()) return null
      throw error
    } finally { requests.current.delete(controller) }
  }

  function beginAction(mutation: boolean) {
    if (actionPending.current) return null
    actionPending.current = true
    mutationPending.current = mutation
    setBusy(true)
    if (mutation) {
      // A response captured before the write must never replace its result.
      requestVersion.current += 1
      for (const request of requests.current) request.abort()
    }
    const generation = lifetime.current
    return () => lifetime.current === generation
  }

  function finishAction(current: () => boolean) {
    if (!current()) return
    actionPending.current = false
    mutationPending.current = false
    setBusy(false)
  }

  async function markRead(id?: number) {
    const current = beginAction(true)
    if (!current) return
    try {
      await readNotificationsAction(id)
      if (!current()) return
      const mark = (items: AccountNotification[]) => items.map((item) => id === undefined || item.id === id ? { ...item, readAt: Date.now() } : item)
      loaded.current = mark(loaded.current)
      older.current = mark(older.current)
      setInbox((value) => ({ ...value, notifications: mergeNotifications(older.current, loaded.current) }))
      await refresh()
    } catch { if (current()) setMessage('Notifications could not be marked read. Try again.') }
    finally { finishAction(current) }
  }

  async function decide(requestId: string, revision: number, decision: 'approved' | 'rejected') {
    const current = beginAction(true)
    if (!current) return
    try {
      const result = await decideViewingAction(requestId, revision, decision)
      if (!current()) return
      setMessage(result.error ?? (decision === 'approved' ? 'Viewing request approved.' : 'Viewing request declined.'))
      await refresh()
      if (current()) router.refresh()
    } catch { if (current()) setMessage('The request could not be updated. Try again.') }
    finally { finishAction(current) }
  }

  async function loadOlder() {
    const current = beginAction(false)
    if (!current) return
    const cursor = cursorVersion.current
    const controller = new AbortController()
    requests.current.add(controller)
    try {
      const response = await fetch(`/api/notifications?before=${before.current}`, { cache: 'no-store', signal: controller.signal })
      if (!current()) return
      if (!response.ok) throw new Error('Notifications could not be loaded.')
      const next: NotificationInbox = await response.json()
      if (!current()) return
      older.current = mergeNotifications(older.current, next.notifications)
      setInbox((value) => ({ ...value, notifications: mergeNotifications(older.current, loaded.current) }))
      // A new full page can reset pagination while this older page is in flight.
      if (cursor === cursorVersion.current) {
        setMore(next.notifications.length === 100)
        if (next.notifications.length) before.current = next.notifications.at(-1)!.id
      }
    } catch { if (current()) setMessage('Older notifications could not be loaded. Try again.') }
    finally { requests.current.delete(controller); finishAction(current) }
  }

  const poll = useEffectEvent(async (reconnecting: boolean, play: (id: number, current: () => boolean) => Promise<void>) => {
    if (mutationPending.current) return null
    return refresh(async (next, current) => {
      const id = next.notifications[0]?.id ?? 0
      if (id > latest.current && next.sound && !reconnecting) await play(id, current)
      if (current()) latest.current = id
    })
  })

  useEffect(() => {
    let active = true
    let audio: AudioContext | null = null
    let pending = false
    let reconnecting = false
    const pendingRequests = requests.current
    const unlock = () => {
      audio ??= new AudioContext()
      void audio.resume().catch(() => {})
    }
    const play = async (id: number, current: () => boolean) => {
      // A browser lock serializes the shared watermark across open tabs.
      if (!navigator.locks || audio?.state !== 'running') return
      await navigator.locks.request(`notification-sound-${userId}`, () => {
        if (!active || !current() || audio?.state !== 'running') return
        const key = `notification-sound-${userId}`
        try {
          if (Number(localStorage.getItem(key) ?? 0) >= id) return
          localStorage.setItem(key, String(id))
        } catch { return }
        void playNotificationTone(audio)
      })
    }
    const timer = setInterval(async () => {
      if (pending) return
      pending = true
      try {
        const received = await poll(reconnecting, play)
        if (received !== null) reconnecting = !received
      } catch { reconnecting = true /* Keep stored notifications visible while disconnected. */ }
      finally { pending = false }
    }, 5000)
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      active = false
      lifetime.current += 1
      clearInterval(timer)
      for (const request of pendingRequests) request.abort()
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      void audio?.close()
    }
  }, [userId])

  return { ...inbox, more, message, busy, markRead, decide, loadOlder }
}
