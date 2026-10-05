'use client'
import * as Dialog from '@radix-ui/react-dialog'
import { Bell, CheckCheck, Users, X } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { useNotificationInbox, type NotificationInbox } from '@/lib/notification-inbox'
import styles from './viewing-access.module.css'

export function NotificationCenter({ userId, initial }: { userId: string; initial: NotificationInbox }) {
  const { notifications, unread, more, message, busy, markRead, decide, loadOlder } = useNotificationInbox(userId, initial)
  return <Dialog.Root><Dialog.Trigger asChild><button className={styles.bell} aria-label={`Notifications, ${unread} unread`}><Bell aria-hidden="true" />{unread > 0 && <span>{unread > 99 ? '99+' : unread}</span>}</button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className={styles.overlay} /><Dialog.Content className={`${styles.inbox} ${styles.notificationInbox}`}>
      <header><div><Dialog.Title>Notifications</Dialog.Title><Dialog.Description>Requests and updates to your viewing access.</Dialog.Description></div><Dialog.Close asChild><Button size="icon" variant="ghost" aria-label="Close notifications"><X /></Button></Dialog.Close></header>
      <div className={styles.inboxToolbar}><span>{unread} unread</span><Button className={styles.readButton} variant="ghost" size="sm" disabled={busy || !unread} onClick={() => markRead()}><CheckCheck aria-hidden="true" />Mark all read</Button></div>
      {notifications.length === 0 && <p>No notifications yet.</p>}
      {notifications.map((notice) => <article key={notice.id} data-read={notice.readAt !== null}>
        <span className={styles.noticeIcon} aria-hidden="true">{notice.requestId ? <Users /> : <Bell />}</span>
        <div className={styles.noticeContent}>
          <div className={styles.noticeHeading}><h3>{notice.title}</h3>{notice.readAt === null && <span className={styles.unreadDot} aria-label="Unread" />}</div>
          <p>{notice.body}</p>
          <p className={styles.noticeMeta}><time dateTime={new Date(notice.createdAt).toISOString()}>{new Date(notice.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</time><span aria-hidden="true"> · </span>{notice.requestId ? 'Viewing request' : 'Account update'}</p>
        {notice.actionable && notice.requestId && notice.revision !== null && <div className={styles.actions}>{(['approved', 'rejected'] as const).map((decision) => <Button className={decision === 'approved' ? styles.approveButton : styles.declineButton} size="sm" variant={decision === 'approved' ? 'default' : 'secondary'} disabled={busy} key={decision} onClick={() => decide(notice.requestId!, notice.revision!, decision)}>{decision === 'approved' ? 'Approve' : 'Decline'}</Button>)}</div>}
        {!notice.readAt && <Button className={styles.readButton} variant="ghost" size="sm" disabled={busy} onClick={() => markRead(notice.id)}>Mark read</Button>}
        </div>
      </article>)}
      {more && notifications.length > 0 && <Button size="sm" variant="secondary" disabled={busy} onClick={loadOlder}>Older notifications</Button>}
      {message && <p role="status">{message}</p>}<Link className={styles.inboxFooter} href="/account/channel">Manage viewing requests and notification sound</Link>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>
}
