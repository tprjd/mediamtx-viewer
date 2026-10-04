'use client'
import { LockKeyhole } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { requestViewingAction } from '@/app/account/channel/viewing-actions'
import type { ViewingRequest } from '@/lib/viewing-requests'
import styles from './viewing-access.module.css'

export function ViewingGate({ slug, owner }: { slug: string; owner: string }) {
  const router = useRouter()
  const [access, setAccess] = useState<{ canRequest: boolean; request: ViewingRequest | null; now: number } | null>(null)
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    const refresh = async () => {
      try {
        const response = await fetch(`/api/channels/${encodeURIComponent(slug)}/viewing-access`, { cache: 'no-store', signal: controller.signal })
        if (!response.ok) { setMessage(response.status === 401 ? 'Sign in to continue.' : 'This channel is not available.'); return }
        const data = await response.json()
        if (data.allowed) { router.refresh(); return }
        setAccess(data)
      } catch { if (!controller.signal.aborted) setMessage('Access could not be checked. Try again shortly.') }
    }
    void refresh()
    const timer = setInterval(refresh, 5000)
    return () => { controller.abort(); clearInterval(timer) }
  }, [slug, router])
  const waiting = access?.request?.status === 'pending'
  const minutes = access?.request ? Math.max(0, Math.ceil((access.request.retryAt - access.now) / 60_000)) : 0
  return <div className={styles.gate}>
    <LockKeyhole aria-hidden="true" /><h2>{waiting ? 'Request sent' : minutes ? 'Viewing access unavailable' : 'Ask to watch this channel'}</h2>
    <p>{waiting ? `${owner} will receive your request. You will get a notification when they decide.` : `Approval from ${owner} lets you watch and join the chat on future visits.`}</p>
    {access && !access.canRequest ? <Link href="/verify-email">Verify email to request access</Link> : <Button disabled={!access || pending || waiting || minutes > 0} onClick={async () => {
      setPending(true)
      const result = await requestViewingAction(slug)
      setMessage(result.error ?? 'Request sent. The owner will be notified.')
      if (!result.error) router.refresh()
      setPending(false)
    }}>{waiting ? 'Request pending' : minutes ? `Try again in ${minutes} minutes` : pending ? 'Sending…' : 'Request to watch'}</Button>}
    {message && <p role="status">{message}</p>}
  </div>
}
