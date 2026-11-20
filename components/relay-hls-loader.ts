import type Hls from 'hls.js'
import type {
  FragmentLoaderContext, HlsConfig, Loader, LoaderCallbacks, LoaderConfiguration, LoaderStats,
} from 'hls.js'

type Rendition = 'primary' | 'fallback'
const objectName = /^[0-9a-f]{12}_(?:video|audio)[1-9][0-9]*_(?:part|seg)[0-9]+\.mp4$/
const maxObjectBytes = 16 * 1024 * 1024
const maxFrameBytes = 16 * 1024
const maxConcurrent = 4
const idleDeadlineMs = 750
const transferDeadlineMs = 8_000

interface Transfer {
  bytes?: Uint8Array<ArrayBuffer>
  offset: number
  timer: ReturnType<typeof setTimeout>
  deadline: number
  idleUntil: number
  checkProgress: () => void
  stats: LoaderStats
  finish: (result: ArrayBuffer | 'http' | 'abort') => void
}

interface Connection {
  pc: RTCPeerConnection
  channel: RTCDataChannel
  abort: AbortController
  timer: ReturnType<typeof setTimeout>
  resource?: URL
}

function sameOriginUrl(input: string): URL | undefined {
  try {
    const url = new URL(input, window.location.href)
    if (url.origin === window.location.origin && !url.username && !url.password) return url
  } catch { /* The normal HLS loader handles other URLs. */ }
}

function objectFor(source: string, context: FragmentLoaderContext): string | undefined {
  if (context.responseType !== 'arraybuffer' || context.rangeStart || context.rangeEnd) return
  const manifest = sameOriginUrl(source)
  const object = sameOriginUrl(context.url)
  if (!manifest || !object || !manifest.pathname.startsWith('/media/hls/') ||
      !manifest.pathname.endsWith('/index.m3u8')) return
  const directory = manifest.pathname.slice(0, manifest.pathname.lastIndexOf('/') + 1)
  if (!object.pathname.startsWith(directory)) return
  const file = object.pathname.slice(directory.length)
  if (file.length <= 128 && objectName.test(file)) return file
}

function waitForIce(pc: RTCPeerConnection, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const complete = () => {
      if (pc.iceGatheringState !== 'complete') return
      pc.removeEventListener('icegatheringstatechange', complete)
      signal.removeEventListener('abort', cancelled)
      resolve()
    }
    const cancelled = () => reject(new Error('ICE gathering stopped.'))
    signal.throwIfAborted()
    pc.addEventListener('icegatheringstatechange', complete, { signal })
    signal.addEventListener('abort', cancelled, { once: true })
    complete()
  })
}

class RelayConnection {
  private current?: Connection
  private attempts = 0
  private nextAttempt = 0
  private bypassUntil = 0
  private sequence = 0
  private transfers = new Map<number, Transfer>()

  constructor(private endpoint: string, private rendition: Rendition) {}

  start() {
    if (this.current || this.attempts >= 2 || Date.now() < this.nextAttempt ||
        typeof RTCPeerConnection === 'undefined') return
    const endpoint = sameOriginUrl(this.endpoint)
    if (!endpoint || !/^\/api\/channels\/[^/]+\/relay\/hls$/.test(endpoint.pathname)) return
    this.attempts++
    this.nextAttempt = Date.now() + 30_000
    let pc: RTCPeerConnection | undefined
    try {
      pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] })
      const channel = pc.createDataChannel('frankerz-hls', { ordered: true })
      channel.binaryType = 'arraybuffer'
      const current: Connection = {
        pc, channel, abort: new AbortController(),
        timer: setTimeout(() => this.stop(current), 20_000),
      }
      this.current = current
      channel.onopen = () => clearTimeout(current.timer)
      channel.onmessage = event => this.receive(event.data)
      channel.onclose = channel.onerror = () => this.stop(current)
      pc.onconnectionstatechange = () => {
        if (current.pc.connectionState === 'failed' || current.pc.connectionState === 'closed') this.stop(current)
      }
      void this.signal(endpoint, current).catch(() => this.stop(current))
    } catch {
      pc?.close()
    }
  }

  private async signal(endpoint: URL, { pc, abort }: Connection) {
    const signal = abort.signal
    await pc.setLocalDescription(await pc.createOffer())
    await waitForIce(pc, signal)
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription!.sdp,
      cache: 'no-store', credentials: 'same-origin', mode: 'same-origin', redirect: 'error', signal,
    })
    const location = response.headers.get('Location')
    const resource = location && new URL(location, endpoint)
    if (response.status !== 201 || !resource || resource.origin !== endpoint.origin ||
        !resource.pathname.startsWith(endpoint.pathname + '/') ||
        !/^[A-Za-z0-9_-]+$/.test(resource.pathname.slice(endpoint.pathname.length + 1))) {
      throw new Error('Invalid relay response.')
    }
    if (!this.current || signal.aborted) {
      this.release(resource)
      return
    }
    this.current.resource = resource
    if (response.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/sdp') {
      throw new Error('Invalid relay answer.')
    }
    const sdp = await response.text()
    signal.throwIfAborted()
    await pc.setRemoteDescription({ type: 'answer', sdp })
  }

  private release(resource: URL) {
    void fetch(resource, {
      method: 'DELETE', credentials: 'same-origin', mode: 'same-origin', redirect: 'error', keepalive: true,
    }).catch(() => {})
  }

  private stop(current: Connection, deliberate = false) {
    if (current !== this.current) return
    this.current = undefined
    clearTimeout(current.timer)
    current.abort.abort()
    current.channel.onopen = current.channel.onmessage = current.channel.onclose = current.channel.onerror = null
    current.pc.onconnectionstatechange = null
    current.channel.close()
    current.pc.close()
    if (current.resource) this.release(current.resource)
    for (const transfer of this.transfers.values()) transfer.finish(deliberate ? 'abort' : 'http')
  }

  close() {
    if (this.current) this.stop(this.current, true)
    this.attempts = this.nextAttempt = this.bypassUntil = 0
  }

  request(file: string, firstByteMs: number, stats: LoaderStats, done: Transfer['finish']): (() => void) | undefined {
    this.start()
    const channel = this.current?.channel
    if (!firstByteMs || channel?.readyState !== 'open' || this.transfers.size >= maxConcurrent || Date.now() < this.bypassUntil) return
    const id = this.sequence = (this.sequence + 1) >>> 0 || 1
    const remove = () => {
      this.transfers.delete(id)
      clearTimeout(transfer.timer)
    }
    const finish: Transfer['finish'] = result => {
      remove()
      if (result === 'http') this.bypassUntil = Date.now() + 2_000
      done(result)
    }
    const checkProgress = () => {
      const remaining = Math.min(transfer.deadline, transfer.idleUntil) - performance.now()
      if (remaining <= 0) finish('http')
      else transfer.timer = setTimeout(checkProgress, Math.ceil(remaining))
    }
    const start = performance.now()
    const transfer: Transfer = {
      offset: 0, stats, finish, checkProgress, timer: setTimeout(checkProgress, firstByteMs),
      deadline: start + transferDeadlineMs, idleUntil: start + firstByteMs,
    }
    this.transfers.set(id, transfer)
    stats.loading.start = start
    try {
      channel.send(JSON.stringify({ id, rendition: this.rendition, file }))
    } catch {
      remove()
      this.bypassUntil = Date.now() + 2_000
      return
    }
    return remove
  }

  private receive(data: unknown) {
    if (typeof data === 'string') {
      if (data.length > 160) return
      try {
        const { id, size, error } = JSON.parse(data)
        const transfer = this.transfers.get(id)
        if (!transfer) return
        if (error || transfer.bytes || !Number.isSafeInteger(size) || size <= 0 || size > maxObjectBytes) {
          transfer.finish('http')
          return
        }
        transfer.bytes = new Uint8Array(size)
        transfer.stats.loading.first = performance.now()
        transfer.idleUntil = transfer.stats.loading.first + idleDeadlineMs
        clearTimeout(transfer.timer)
        transfer.timer = setTimeout(transfer.checkProgress, idleDeadlineMs)
        transfer.stats.total = size
      } catch { /* Ignore malformed or stale messages. Each request has a deadline. */ }
      return
    }
    if (!(data instanceof ArrayBuffer) || data.byteLength < 4) return
    const id = new DataView(data).getUint32(0)
    const transfer = this.transfers.get(id)
    if (!transfer) return
    const bytes = new Uint8Array(data, 4)
    const now = performance.now()
    if (now >= transfer.deadline || !transfer.bytes || !bytes.length || data.byteLength > maxFrameBytes ||
        transfer.offset + bytes.length > transfer.bytes.length) {
      transfer.finish('http')
      return
    }
    transfer.bytes.set(bytes, transfer.offset)
    transfer.offset += bytes.length
    transfer.stats.loaded = transfer.offset
    transfer.idleUntil = now + idleDeadlineMs
    if (transfer.offset === transfer.bytes.length) transfer.finish(transfer.bytes.buffer)
  }
}

/** Each HLS run shares one background connection across its fragment loaders. */
export function createRelayHlsLoader(endpoint: string, source: string, rendition: Rendition) {
  const relay = new RelayConnection(endpoint, rendition)
  let player: Pick<Hls, 'mainForwardBufferInfo'> | undefined

  class FragmentLoader implements Loader<FragmentLoaderContext> {
    readonly stats: LoaderStats
    context: FragmentLoaderContext | null = null
    private http: Loader<FragmentLoaderContext>
    private cancel?: () => void
    private onAbort?: () => void

    constructor(config: HlsConfig) {
      this.http = new config.loader(config) as Loader<FragmentLoaderContext>
      this.stats = this.http.stats
    }

    load(context: FragmentLoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<FragmentLoaderContext>) {
      this.context = context
      const http = () => {
        this.stats.loading.start = this.stats.loading.first = this.stats.loaded = this.stats.total = 0
        this.http.load(context, config, callbacks)
      }
      const file = objectFor(source, context)
      if (file) {
        this.onAbort = () => {
          this.stats.aborted = true
          callbacks.onAbort?.(this.stats, context, null)
        }
        // A cold whole segment can take seconds to reach the PC. Keep one
        // second in reserve for HTTP and use HTTP immediately at startup.
        let firstByteMs = idleDeadlineMs
        if (/_seg[0-9]+\.mp4$/.test(file)) {
          const bufferedMs = (player?.mainForwardBufferInfo?.len ?? 0) * 1000
          firstByteMs = bufferedMs >= 1_750 ? Math.min(2_500, bufferedMs - 1_000) : 0
        }
        this.cancel = relay.request(file, firstByteMs, this.stats, result => {
          this.cancel = undefined
          if (result === 'abort') { this.onAbort?.(); return }
          if (result === 'http') { http(); return }
          const stats = this.stats
          stats.loading.end = performance.now()
          stats.bwEstimate = stats.total * 8000 / Math.max(1, stats.loading.end - stats.loading.first)
          callbacks.onProgress?.(stats, context, result, null)
          if (this.context) callbacks.onSuccess({ url: context.url, data: result, code: 200 }, stats, context, null)
        })
        if (this.cancel) return
      }
      http()
    }

    abort() {
      if (this.cancel) {
        this.cancel()
        this.cancel = undefined
        this.onAbort?.()
      } else this.http.abort()
    }

    destroy() {
      this.cancel?.()
      this.cancel = this.onAbort = undefined
      this.context = null
      this.http.destroy()
    }

    getResponseHeader(name: string) { return this.http.getResponseHeader?.(name) ?? null }
    getCacheAge() { return this.http.getCacheAge?.() ?? null }
  }

  return {
    fLoader: FragmentLoader,
    start(instance: Pick<Hls, 'mainForwardBufferInfo'>) { player = instance; relay.start() },
    close() { player = undefined; relay.close() },
  }
}

/** A relay can go online or offline while this hls.js instance keeps playing. */
export function attachRelayHlsLoader(hls: Hls, relay?: ReturnType<typeof createRelayHlsLoader>) {
  hls.config.fLoader = relay?.fLoader
  relay?.start(hls)
  return () => relay?.close()
}
