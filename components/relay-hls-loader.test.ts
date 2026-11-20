import Hls, { Fragment, LoadStats, type FragmentLoaderContext, type LoaderContext, type PlaylistLevelType } from 'hls.js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createRelayHlsLoader } from './relay-hls-loader'

const endpoint = '/api/channels/friend/relay/hls?frankerzspam_viewer=example'
const directory = '/media/hls/_hls/channels/friend/generation/'
const source = directory + 'index.m3u8'
const file = '012345abcdef_video1_part17.mp4'
class Http {
  stats = new LoadStats()
  context: LoaderContext | null = null
  load = vi.fn()
  abort = vi.fn()
  destroy = vi.fn()
  constructor() { http.push(this) }
}
let http: Http[]
const peers: Peer[] = []
class Peer extends EventTarget {
  iceGatheringState = 'complete'
  localDescription = { sdp: 'gathered offer' }
  createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'offer' }))
  setLocalDescription = vi.fn()
  setRemoteDescription = vi.fn()
  close = vi.fn()
  channel = {
    readyState: 'connecting',
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onopen: null as (() => void) | null,
    onclose: null as (() => void) | null,
    close: vi.fn(),
    send: vi.fn(),
  }
  createDataChannel = vi.fn(() => this.channel)
  constructor() { super(); peers.push(this) }
}
const fetchMock = vi.fn()
beforeEach(() => {
  vi.useFakeTimers()
  peers.length = 0
  vi.stubGlobal('RTCPeerConnection', Peer)
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset().mockImplementation(async () => new Response('answer', {
    status: 201, headers: { Location: '/api/channels/friend/relay/hls/session-id', 'Content-Type': 'application/sdp' },
  }))
  http = []
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

function fixture(rendition: 'primary' | 'fallback' = 'primary', bufferedSeconds = 4) {
  const relay = createRelayHlsLoader(endpoint, source, rendition)
  function load(url = directory + file + '?session=private-token', overrides: Partial<FragmentLoaderContext> = {}) {
    const loader = new relay.fLoader({ ...Hls.DefaultConfig, loader: Http })
    const context: FragmentLoaderContext = {
      type: 'media-fragment' as FragmentLoaderContext['type'], frag: new Fragment('main' as PlaylistLevelType, source), part: null,
      responseType: 'arraybuffer', url, rangeStart: 0, rangeEnd: 0, ...overrides,
    }
    const callbacks = { onSuccess: vi.fn(), onProgress: vi.fn(), onError: vi.fn(), onTimeout: vi.fn(), onAbort: vi.fn() }
    loader.load(context, { timeout: 2_000, maxRetry: 0, retryDelay: 0, maxRetryDelay: 0,
      loadPolicy: Hls.DefaultConfig.fragLoadPolicy.default }, callbacks)
    return { loader, callbacks, context, http: http.at(-1)! }
  }
  async function connect() {
    relay.start({ mainForwardBufferInfo: { len: bufferedSeconds, start: 0, end: bufferedSeconds, bufferedIndex: 0 } })
    expect(load().http.load).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(0)
    expect(peers[0].setRemoteDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'answer' })
    peers[0].channel.readyState = 'open'
    peers[0].channel.onopen!()
  }
  return { load, connect, close: relay.close }
}

function receive(data: unknown) { peers[0].channel.onmessage!({ data }) }
function frame(id: number, ...payload: number[]) {
  const bytes = new Uint8Array(4 + payload.length)
  new DataView(bytes.buffer).setUint32(0, id)
  bytes.set(payload, 4)
  return bytes.buffer
}

it.each(['primary', 'fallback'] as const)('delivers %s fragments on a shared ordered channel and uses the original hls.js stats', async rendition => {
  const { connect, load, close } = fixture(rendition)
  await connect()
  expect(peers[0].createDataChannel).toHaveBeenCalledWith('frankerz-hls', { ordered: true })
  expect(fetchMock.mock.calls[0][0].pathname + fetchMock.mock.calls[0][0].search).toBe(endpoint)
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ body: 'gathered offer', credentials: 'same-origin', redirect: 'error' })
  const first = load()
  const second = load(directory + '012345abcdef_audio1_seg8.mp4')
  expect(peers[0].channel.send.mock.calls.map(([value]) => JSON.parse(value))).toEqual([
    { id: 1, rendition, file }, { id: 2, rendition, file: '012345abcdef_audio1_seg8.mp4' },
  ])
  receive(JSON.stringify({ id: 1, size: 3 }))
  receive(JSON.stringify({ id: 2, size: 1 }))
  receive(frame(1, 11))
  receive(frame(2, 42))
  receive(frame(1, 12, 13))
  for (const [request, payload] of [[first, [11, 12, 13]], [second, [42]]] as const) {
    const data = new Uint8Array(payload).buffer
    expect(request.callbacks.onSuccess).toHaveBeenCalledExactlyOnceWith(
      { url: request.context.url, code: 200, data }, request.loader.stats, request.context, null,
    )
    expect(request.callbacks.onProgress).toHaveBeenCalledExactlyOnceWith(request.loader.stats, request.context, data, null)
    expect(request.loader.stats.loaded).toBe(payload.length)
    expect(request.http.load).not.toHaveBeenCalled()
  }
  close()
  expect(peers[0].close).toHaveBeenCalledOnce()
  expect(fetchMock.mock.calls[1][1].method).toBe('DELETE')
})

it('keeps setup, keys, init files, ranges, other origins and old HLS generations on the normal loader', async () => {
  const { load, connect, close } = fixture()
  await connect()
  for (const url of [source, directory + '012345abcdef_video1_init.mp4', directory + 'content.key',
    directory + 'subdir/' + file, directory + '../old/' + file, 'https://elsewhere.invalid' + directory + file]) {
    expect(load(url).http.load).toHaveBeenCalledOnce()
  }
  expect(load(directory + file, { rangeEnd: 4096 }).http.load).toHaveBeenCalledOnce()
  expect(peers[0].channel.send).not.toHaveBeenCalled()
  close()
})

it.each([{ buffered: 0, wait: 0 }, { buffered: 2.2, wait: 1_200 }, { buffered: 7, wait: 2_500 }])(
  'keeps HTTP available for whole segments with $buffered seconds buffered', async ({ buffered, wait }) => {
    const { load, connect, close } = fixture('primary', buffered)
    await connect()
    const request = load(directory + '012345abcdef_video1_seg2.mp4')
    if (wait) {
      await vi.advanceTimersByTimeAsync(wait - 1)
      expect(request.http.load).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
    }
    expect(request.http.load).toHaveBeenCalledOnce()
    close()
  },
)

it('keeps every request on HTTP when the site denies signaling and bounds repeated connection attempts', async () => {
  fetchMock.mockImplementation(async () => new Response(null, { status: 403 }))
  const { load, close } = fixture()
  for (let attempt = 0; attempt < 3; attempt++) {
    expect(load().http.load).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(31_000)
  }
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(peers.every(peer => peer.close.mock.calls.length === 1)).toBe(true)
  close()
})

it.each(['cache miss', 'oversize', 'invalid frame', 'timeout', 'channel closed'])('retries the original authorized URL once over HTTP on %s', async reason => {
  const { connect, load, close } = fixture()
  await connect()
  const request = load()
  if (reason === 'cache miss') receive(JSON.stringify({ id: 1, error: true }))
  if (reason === 'oversize') receive(JSON.stringify({ id: 1, size: 16 * 1024 * 1024 + 1 }))
  if (reason === 'invalid frame') { receive(JSON.stringify({ id: 1, size: 1 })); receive(frame(1, 1, 2)) }
  if (reason === 'timeout') await vi.advanceTimersByTimeAsync(751)
  if (reason === 'channel closed') peers[0].channel.onclose!()
  expect(request.http.load).toHaveBeenCalledExactlyOnceWith(request.context, expect.anything(), request.callbacks)
  expect(request.loader.stats.loading.start).toBe(0)
  expect(request.callbacks.onSuccess).not.toHaveBeenCalled()
  expect(load().http.load).toHaveBeenCalledOnce()
  close()
})

it('retires pending fragments on abort and run teardown without retrying or processing late frames', async () => {
  const { load, connect, close } = fixture()
  await connect()
  const aborted = load()
  aborted.loader.abort()
  receive(JSON.stringify({ id: 1, size: 1 }))
  receive(frame(1, 1))
  const destroyed = load()
  destroyed.loader.destroy()
  const remaining = load()
  close()
  await vi.advanceTimersByTimeAsync(10_000)
  for (const item of [aborted, remaining]) expect(item.callbacks.onAbort).toHaveBeenCalledOnce()
  for (const item of [aborted, destroyed, remaining]) {
    expect(item.callbacks.onSuccess).not.toHaveBeenCalled()
    expect(item.http.load).not.toHaveBeenCalled()
  }
})
