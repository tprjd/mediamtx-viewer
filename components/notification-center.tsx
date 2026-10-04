'use client'
import * as Dialog from '@radix-ui/react-dialog'
import { Bell, CheckCheck, Users, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { decideViewingAction, readNotificationsAction } from '@/app/account/channel/viewing-actions'
import type { AccountNotification } from '@/lib/viewing-requests'
import { mergeNotifications } from '@/lib/notification-inbox'
import { playNotificationTone } from '@/lib/notification-sound'
import styles from './viewing-access.module.css'

type Inbox = { notifications: AccountNotification[]; unread: number; sound: boolean }

export function NotificationCenter({ userId, initial }: { userId: string; initial: Inbox }) {
  const [inbox, setInbox] = useState(initial)
  const [older, setOlder] = useState<AccountNotification[]>([])
  const [more, setMore] = useState(initial.notifications.length === 100)
  const before = useRef(initial.notifications.at(-1)?.id)
  const loaded = useRef(initial.notifications)
  const notices = mergeNotifications(older, inbox.notifications)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const latest = useRef(initial.notifications[0]?.id ?? 0)
  const audio = useRef<AudioContext | null>(null)
  const router = useRouter()
  function receive(next: Inbox) {
    if (next.notifications.length === 100 && !next.notifications.some((item) => loaded.current.some((old) => old.id === item.id))) {
      before.current = next.notifications.at(-1)!.id
      setMore(true)
    }
    loaded.current = mergeNotifications(loaded.current, next.notifications)
    setInbox({ ...next, notifications: loaded.current })
  }
  async function markRead(id?: number) {
    setBusy(true)
    try {
      await readNotificationsAction(id)
      const mark = (items: AccountNotification[]) => items.map((item) => id === undefined || item.id === id ? { ...item, readAt: Date.now() } : item)
      loaded.current = mark(loaded.current)
      setInbox((current) => ({ ...current, notifications: loaded.current }))
      setOlder(mark)
      await refresh()
    } catch { setMessage('Notifications could not be marked read. Try again.') }
    finally { setBusy(false) }
  }
  async function refresh() {
    const response = await fetch('/api/notifications', { cache: 'no-store' })
    if (response.ok) receive(await response.json())
  }
  useEffect(() => {
    let active = true
    const unlock = () => {
      audio.current ??= new AudioContext()
      void audio.current.resume().catch(() => {})
    }
    const play = async (id: number) => {
      // A browser lock serializes the shared watermark across open tabs.
      if (!navigator.locks || audio.current?.state !== 'running') return
      await navigator.locks.request(`notification-sound-${userId}`, () => {
        const key = `notification-sound-${userId}`
        try {
          if (Number(localStorage.getItem(key) ?? 0) >= id) return
          localStorage.setItem(key, String(id))
        } catch { return }
        const context = audio.current
        if (!context || context.state !== 'running') return
        void playNotificationTone(context)
      })
    }
    let pending = false
    let reconnecting = false
    const poll = async () => {
      if (pending) return
      pending = true
      try {
        const response = await fetch('/api/notifications', { cache: 'no-store' })
        if (!response.ok || !active) { reconnecting = true; return }
        const next: Inbox = await response.json()
        const id = next.notifications[0]?.id ?? 0
        if (id > latest.current && next.sound && !reconnecting) await play(id)
        reconnecting = false
        latest.current = id
        if (active) receive(next)
      } catch { reconnecting = true /* Keep stored notifications visible while the connection is down. */ }
      finally { pending = false }
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    const timer = setInterval(poll, 5000)
    return () => { active = false; clearInterval(timer); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); void audio.current?.close(); audio.current = null }
  }, [userId])
  return <Dialog.Root><Dialog.Trigger asChild><button className={styles.bell} aria-label={`Notifications, ${inbox.unread} unread`}><Bell aria-hidden="true" />{inbox.unread > 0 && <span>{inbox.unread > 99 ? '99+' : inbox.unread}</span>}</button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className={styles.overlay} /><Dialog.Content className={`${styles.inbox} ${styles.notificationInbox}`}>
      <header><div><Dialog.Title>Notifications</Dialog.Title><Dialog.Description>Requests and updates to your viewing access.</Dialog.Description></div><Dialog.Close asChild><Button size="icon" variant="ghost" aria-label="Close notifications"><X /></Button></Dialog.Close></header>
      <div className={styles.inboxToolbar}><span>{inbox.unread} unread</span><Button className={styles.readButton} variant="ghost" size="sm" disabled={busy || !inbox.unread} onClick={() => markRead()}><CheckCheck aria-hidden="true" />Mark all read</Button></div>
      {inbox.notifications.length === 0 && <p>No notifications yet.</p>}
      {notices.map((notice) => <article key={notice.id} data-read={notice.readAt !== null}>
        <span className={styles.noticeIcon} aria-hidden="true">{notice.requestId ? <Users /> : <Bell />}</span>
        <div className={styles.noticeContent}>
          <div className={styles.noticeHeading}><h3>{notice.title}</h3>{notice.readAt === null && <span className={styles.unreadDot} aria-label="Unread" />}</div>
          <p>{notice.body}</p>
          <p className={styles.noticeMeta}><time dateTime={new Date(notice.createdAt).toISOString()}>{new Date(notice.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</time><span aria-hidden="true"> · </span>{notice.requestId ? 'Viewing request' : 'Account update'}</p>
        {notice.actionable && notice.requestId && notice.revision !== null && <div className={styles.actions}>{(['approved', 'rejected'] as const).map((decision) => <Button className={decision === 'approved' ? styles.approveButton : styles.declineButton} size="sm" variant={decision === 'approved' ? 'default' : 'secondary'} disabled={busy} key={decision} onClick={async () => {
          setBusy(true)
          try {
            const result = await decideViewingAction(notice.requestId!, notice.revision!, decision)
            setMessage(result.error ?? (decision === 'approved' ? 'Viewing request approved.' : 'Viewing request declined.'))
            await refresh(); router.refresh()
          } catch { setMessage('The request could not be updated. Try again.') }
          finally { setBusy(false) }
        }}>{decision === 'approved' ? 'Approve' : 'Decline'}</Button>)}</div>}
        {!notice.readAt && <Button className={styles.readButton} variant="ghost" size="sm" disabled={busy} onClick={() => markRead(notice.id)}>Mark read</Button>}
        </div>
      </article>)}
      {more && notices.length > 0 && <Button size="sm" variant="secondary" disabled={busy} onClick={async () => {
        setBusy(true)
        try {
          const response = await fetch(`/api/notifications?before=${before.current}`, { cache: 'no-store' })
          if (!response.ok) throw new Error('Notifications could not be loaded.')
          const next: Inbox = await response.json()
          setOlder((items) => mergeNotifications(items, next.notifications)); setMore(next.notifications.length === 100)
          if (next.notifications.length) before.current = next.notifications.at(-1)!.id
        } catch { setMessage('Older notifications could not be loaded. Try again.') }
        finally { setBusy(false) }
      }}>Older notifications</Button>}
      {message && <p role="status">{message}</p>}<Link className={styles.inboxFooter} href="/account/channel">Manage viewing requests and notification sound</Link>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>
}
