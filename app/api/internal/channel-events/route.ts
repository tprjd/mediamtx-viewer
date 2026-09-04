import { timingSafeEqual } from 'node:crypto'

import { authEnvironment } from '@/lib/auth/env'
import {
  getChannelStatusMonitor,
  type ChannelMonitorEvent,
} from '@/lib/channel-status-monitor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const heartbeatIntervalMs = 20_000
const encoder = new TextEncoder()

function internalSecretMatches(received: string | null): boolean {
  if (!received || !authEnvironment.internalSecret) return false
  const expected = Buffer.from(authEnvironment.internalSecret)
  const actual = Buffer.from(received)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function encodeEvent(type: string, data: unknown, id?: number): Uint8Array {
  return encoder.encode(
    `${id === undefined ? '' : `id: ${id}\n`}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`,
  )
}

export async function GET(request: Request): Promise<Response> {
  if (!internalSecretMatches(request.headers.get('x-internal-auth'))) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const monitor = getChannelStatusMonitor()
  let unsubscribe: (() => void) | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let removeAbortListener: (() => void) | undefined
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const dispose = (closeController: boolean) => {
        if (closed) return
        closed = true
        unsubscribe?.()
        clearInterval(heartbeat)
        removeAbortListener?.()
        if (closeController) {
          try {
            controller.close()
          } catch {
            // The client may already have cancelled the stream.
          }
        }
      }

      const send = (event: ChannelMonitorEvent) => {
        if (closed) return
        try {
          controller.enqueue(encodeEvent(event.type, event.data, event.id))
        } catch {
          dispose(false)
        }
      }

      const handleAbort = () => dispose(true)
      request.signal.addEventListener('abort', handleAbort, { once: true })
      removeAbortListener = () =>
        request.signal.removeEventListener('abort', handleAbort)

      void monitor
        .subscribe(send)
        .then((stop) => {
          if (closed) {
            stop()
            return
          }
          unsubscribe = stop
          heartbeat = setInterval(() => {
            if (closed) return
            try {
              controller.enqueue(
                encodeEvent('heartbeat', { at: new Date().toISOString() }),
              )
            } catch {
              dispose(false)
            }
          }, heartbeatIntervalMs)
          heartbeat.unref?.()
        })
        .catch(() => dispose(true))
    },
    cancel() {
      closed = true
      unsubscribe?.()
      clearInterval(heartbeat)
      removeAbortListener?.()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'private, no-cache, no-store, max-age=0, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
