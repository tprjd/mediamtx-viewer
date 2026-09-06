'use client'

import { useActionState, useRef, useState } from 'react'
import { Copy, KeyRound, RotateCw } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'

import {
  generateStreamKeyAction,
  type StreamKeyActionState,
} from '@/app/account/channel/actions'
import { Button } from '@/components/ui/button'
import styles from './stream-key-manager.module.css'

const initialState: StreamKeyActionState = {}

interface StreamKeyManagerProps {
  hasKey: boolean
  keyHint: string | null
  mediaPath: string
  serverUrl: string
}

export function StreamKeyManager({
  hasKey,
  keyHint,
  mediaPath,
  serverUrl,
}: StreamKeyManagerProps) {
  const [state, action, pending] = useActionState(generateStreamKeyAction, initialState)
  const [copied, setCopied] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const confirmedRef = useRef(false)
  const formRef = useRef<HTMLFormElement>(null)
  const currentHasKey = hasKey || Boolean(state.key)
  const currentHint = state.hint ?? keyHint
  const playPath = (token: string) => `${mediaPath}?token=${token}`
  const fullUrl = (token: string) => `${serverUrl}/${playPath(token)}`

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value)
    setCopied(label)
  }

  function confirmRotate() {
    confirmedRef.current = true
    setConfirmOpen(false)
    formRef.current?.requestSubmit()
  }

  return (
    <div className={styles.streamKeyManager}>
      <dl className={styles.obsSettings}>
        <div>
          <dt>Service</dt>
          <dd>Enhanced RTMP (rtmp://)</dd>
        </div>
        <div>
          <dt>Server</dt>
          <dd>
            <code>{serverUrl}</code>
            <button onClick={() => copy('server', serverUrl)} type="button">
              <Copy aria-hidden="true" /> {copied === 'server' ? 'Copied' : 'Copy'}
            </button>
          </dd>
        </div>
        <div>
          <dt>Stream key / play path</dt>
          <dd>
            {state.key ? (
              <>
                <code>{playPath(state.key!)}</code>
                <button onClick={() => copy('playPath', playPath(state.key!))} type="button">
                  <Copy aria-hidden="true" /> {copied === 'playPath' ? 'Copied' : 'Copy'}
                </button>
              </>
            ) : currentHint ? `Current key ends in ${currentHint}` : 'No key generated'}
          </dd>
        </div>
      </dl>

      {state.key && (
        <aside className={styles.streamKeyReveal}>
          <strong>Paste these into OBS. They are shown only once.</strong>
          <div className={styles.streamKeyRevealRow}>
            <span>Full URL</span>
            <code>{fullUrl(state.key!)}</code>
            <Button
              onClick={() => copy('fullUrl', fullUrl(state.key!))}
              size="sm"
              variant="secondary"
            >
              <Copy aria-hidden="true" /> {copied === 'fullUrl' ? 'Copied' : 'Copy URL'}
            </Button>
          </div>
          <div className={styles.streamKeyRevealRow}>
            <span>Raw key</span>
            <code>{state.key!}</code>
            <Button
              onClick={() => copy('key', state.key!)}
              size="sm"
              variant="secondary"
            >
              <Copy aria-hidden="true" /> {copied === 'key' ? 'Copied' : 'Copy key'}
            </Button>
          </div>
        </aside>
      )}
      {state.error && <p className="error-banner" role="alert">{state.error}</p>}
      {state.warning && <p className="notice-banner">{state.warning}</p>}

      <form
        ref={formRef}
        action={action}
        onSubmit={(event) => {
          if (currentHasKey && !confirmedRef.current) {
            event.preventDefault()
            setConfirmOpen(true)
            return
          }
          confirmedRef.current = false
        }}
      >
        <Button disabled={pending} type="submit" variant="secondary">
          {currentHasKey ? <RotateCw aria-hidden="true" /> : <KeyRound aria-hidden="true" />}
          {pending
            ? 'Generating…'
            : currentHasKey
              ? 'Rotate stream key'
              : 'Generate stream key'}
        </Button>
      </form>

      <Dialog.Root open={confirmOpen} onOpenChange={setConfirmOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.modalBackdrop} />
          <Dialog.Content className={styles.modalCard}>
            <Dialog.Title className={styles.modalTitle}>Rotate stream key?</Dialog.Title>
            <Dialog.Description className={styles.modalDescription}>
              The current key will stop working immediately.
            </Dialog.Description>
            <div className={styles.modalActions}>
              <Dialog.Close asChild>
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button onClick={confirmRotate} type="button">
                Rotate key
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
