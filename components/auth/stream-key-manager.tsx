'use client'

import { useActionState, useState } from 'react'
import { Copy, KeyRound, RotateCw } from 'lucide-react'

import {
  generateStreamKeyAction,
  type StreamKeyActionState,
} from '@/app/account/channel/actions'
import { Button } from '@/components/ui/button'

const initialState: StreamKeyActionState = {}

interface StreamKeyManagerProps {
  hasKey: boolean
  keyHint: string | null
  serverUrl: string
}

export function StreamKeyManager({
  hasKey,
  keyHint,
  serverUrl,
}: StreamKeyManagerProps) {
  const [state, action, pending] = useActionState(generateStreamKeyAction, initialState)
  const [copied, setCopied] = useState<string | null>(null)
  const currentHasKey = hasKey || Boolean(state.key)
  const currentHint = state.hint ?? keyHint

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value)
    setCopied(label)
  }

  return (
    <div className="stream-key-manager">
      <dl className="obs-settings">
        <div>
          <dt>Service</dt>
          <dd>WHIP</dd>
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
          <dt>Bearer token</dt>
          <dd>{currentHint ? `Current key ends in ${currentHint}` : 'No key generated'}</dd>
        </div>
      </dl>

      {state.key && (
        <aside className="stream-key-reveal">
          <strong>Copy this key now. It will not be shown again.</strong>
          <code>{state.key}</code>
          <Button onClick={() => copy('key', state.key!)} size="sm" variant="secondary">
            <Copy aria-hidden="true" /> {copied === 'key' ? 'Copied' : 'Copy stream key'}
          </Button>
        </aside>
      )}
      {state.error && <p className="error-banner" role="alert">{state.error}</p>}
      {state.warning && <p className="notice-banner">{state.warning}</p>}

      <form
        action={action}
        onSubmit={(event) => {
          if (
            currentHasKey &&
            !window.confirm(
              'Rotate the stream key? The current key will stop working immediately.',
            )
          ) {
            event.preventDefault()
          }
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
    </div>
  )
}
