'use client'
import * as Dialog from '@radix-ui/react-dialog'
import { Bell, Volume2 } from 'lucide-react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { decideViewingAction, notificationSoundAction } from '@/app/account/channel/viewing-actions'
import type { ViewingRequest } from '@/lib/viewing-requests'
import { playNotificationTone } from '@/lib/notification-sound'
import styles from './viewing-access.module.css'
import channelStyles from '@/app/account/channel/channel.module.css'

export function ChannelViewingSettings({ requests, sound }: { requests: ViewingRequest[]; sound: boolean }) {
  const [filter, setFilter] = useState('pending')
  const [revoking, setRevoking] = useState<ViewingRequest | null>(null)
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [soundMessage, setSoundMessage] = useState('')
  const router = useRouter()
  async function decide(request: ViewingRequest, decision: 'approved' | 'rejected' | 'revoked') {
    setPending(true)
    try {
      const result = await decideViewingAction(request.id, request.revision, decision)
      setMessage(result.error ?? (decision === 'approved' ? 'Viewing request approved.' : decision === 'rejected' ? 'Viewing request declined.' : 'Channel approval removed.'))
      setRevoking(null); router.refresh()
    } catch { setMessage('The decision could not be saved. Try again.') }
    finally { setPending(false) }
  }
  const waiting = requests.filter((request) => request.status === 'pending').length
  const approved = requests.filter((request) => request.status === 'approved').length
  const visible = requests.filter((request) => filter === 'history' ? ['rejected', 'revoked', 'closed'].includes(request.status) : request.status === filter)
  return <div className={styles.settings}>
    <section className={`${channelStyles.panel} ${styles.audiencePanel}`}>
      <header className={styles.audienceHeading}>
        <div><p className={styles.audienceEyebrow}>Viewing access</p><h2>Your audience</h2></div>
        <div className={styles.waitingCount}>{waiting}<span>waiting</span></div>
      </header>
      <p className={styles.audienceDescription}>These people need your approval. Accounts approved by an administrator can already watch.</p>
      <div className={styles.filters}>{[['pending', 'Requests'], ['approved', 'Approved'], ['history', 'History']].map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}{value !== 'history' && <span className={styles.filterCount}>{value === 'pending' ? waiting : approved}</span>}</button>)}</div>
      {visible.length === 0 && <p className={styles.empty}>{filter === 'pending' ? 'No viewing requests waiting.' : 'No entries yet.'}</p>}
      <div>{visible.map((request) => <div className={styles.row} key={request.id}><span className={styles.viewerAvatar} aria-hidden="true">{request.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span><div className={styles.viewerDetails}><strong>{request.name}</strong><p>{request.status === 'pending' ? 'Not approved by an administrator' : request.status === 'approved' ? 'Can watch this channel on future visits' : request.status === 'closed' ? 'Closed after administrator approval' : request.status === 'rejected' ? 'Declined' : 'Approval removed'}</p></div><div className={styles.actions}>
        {request.status === 'pending' && <><Button className={channelStyles.primaryButton} size="sm" disabled={pending} onClick={() => decide(request, 'approved')}>Approve</Button><Button className={channelStyles.secondaryButton} size="sm" variant="secondary" disabled={pending} onClick={() => decide(request, 'rejected')}>Decline</Button></>}
        {request.status === 'approved' && <Button className={channelStyles.secondaryButton} size="sm" variant="secondary" disabled={pending} onClick={() => setRevoking(request)}>Revoke approval</Button>}
      </div></div>)}</div>
      {message && <p role="status">{message}</p>}
    </section>
    <section className={`${channelStyles.panel} ${styles.soundPanel}`}>
      <h2><Bell aria-hidden="true" /> Notification sound</h2>
      <div className={styles.soundControl}>
        <div><strong>Play a sound</strong><p>{sound ? 'On for new notifications' : 'Off. Notifications still arrive.'}</p></div>
        <label className={channelStyles.notificationSwitch}>
          <input aria-label="Play a sound for new in-app notifications" role="switch" type="checkbox" checked={sound} disabled={pending} onChange={async (event) => { setPending(true); try { await notificationSoundAction(event.target.checked); setSoundMessage(''); router.refresh() } catch { setSoundMessage('Sound setting could not be saved.') } finally { setPending(false) } }} />
          <span aria-hidden="true" />
        </label>
      </div>
      <p className={styles.soundDescription}>Applies to all your in-app notifications, on every device. Old notifications stay silent.</p>
      <Button className={channelStyles.secondaryButton} disabled={previewing} onClick={async () => {
        setPreviewing(true)
        setSoundMessage('')
        let context: AudioContext | undefined
        try {
          context = new AudioContext()
          await context.resume()
          await playNotificationTone(context)
          setSoundMessage('Sound preview played.')
        } catch { setSoundMessage('Sound could not be played. Check your browser sound settings.') }
        finally { void context?.close(); setPreviewing(false) }
      }}><Volume2 aria-hidden="true" />{previewing ? 'Playing…' : 'Preview sound'}</Button>
      {soundMessage && <p className={styles.soundStatus} role="status">{soundMessage}</p>}
    </section>
    <Dialog.Root open={Boolean(revoking)} onOpenChange={(open) => { if (!open) setRevoking(null) }}><Dialog.Portal><Dialog.Overlay className={styles.overlay} /><Dialog.Content className={`${styles.inbox} ${styles.confirmation}`}>
      <Dialog.Title>Revoke {revoking?.name}&apos;s approval?</Dialog.Title><Dialog.Description>They lose access to this channel and chat unless an administrator has approved their account. They can request again after 30 minutes.</Dialog.Description>
      <div className={styles.actions}><Dialog.Close asChild><Button className={channelStyles.secondaryButton} variant="secondary">Cancel</Button></Dialog.Close><Button className={channelStyles.dangerButton} disabled={pending} onClick={() => { if (revoking) void decide(revoking, 'revoked') }}>Revoke approval</Button></div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>
}
