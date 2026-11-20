// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/relay/source/hls/[rendition]/[object]/route'

vi.mock('server-only', () => ({}))
const state = vi.hoisted(() => ({ generation: '', paired: true, fallback: '', status: vi.fn() }))
const bearer = 'mtx_rc_' + 'a'.repeat(43)
vi.mock('@/lib/relay-credentials', async importOriginal => ({
  ...await importOriginal<typeof import('./relay-credentials')>(),
  getRelayCredential: (value: string) => value === bearer && state.paired
    ? { generation: state.generation, channelSlug: 'demo', mediaPath: 'channels/demo' } : null,
}))
vi.mock('@/lib/channels', () => ({ getChannel: () => ({ fallbackMediaPath: state.fallback }) }))
vi.mock('@/lib/mediamtx', () => ({ getChannelStatus: state.status }))

const object = '0123456789ab_video1_part127.mp4'
const cookie = 'hlsSession=3915c109-4c22-46a8-a7b8-03a9abb06be7'
const master = () => new Response('#EXTM3U', { headers: { 'Set-Cookie': cookie + '; HttpOnly' } })
const media = () => new Response(new Uint8Array([7, 1, 6]), { headers: { 'Content-Type': 'video/mp4' } })
function request(file = object, rendition = 'primary', search = '', headers = {}) {
  return GET(new Request('https://site.invalid/api/relay/source/hls/' + rendition + '/' + file + search, {
    headers: { Authorization: 'Bearer ' + bearer, ...headers },
  }), { params: Promise.resolve({ rendition, object: file }) })
}

beforeEach(() => {
  state.generation = randomUUID()
  state.paired = true
  state.fallback = ''
  state.status.mockReset()
  vi.stubEnv('MEDIAMTX_HLS_URL', 'http://private-origin.invalid:8888')
  vi.stubEnv('WHIP_PILOT_CHANNEL', '')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

it('opens one cookie session for parallel objects and returns only original media bytes', async () => {
  const upstream = vi.fn(async (url: URL, init: RequestInit) => {
    expect(url.origin).toBe('http://private-origin.invalid:8888')
    const headers = new Headers(init.headers)
    expect(headers.has('authorization')).toBe(false)
    expect(init.redirect).toBe('error')
    if (url.pathname.endsWith('/index.m3u8')) {
      expect(url.pathname).toBe('/channels/demo/index.m3u8')
      expect(headers.get('cookie')).toBe('cookieCheck=1')
      expect(url.searchParams.get('frankerzspam_internal')).toBe('relay')
      return master()
    }
    expect(url.pathname).toBe('/channels/demo/' + object)
    expect(url.search).toBe('')
    expect(headers.get('cookie')).toBe(cookie)
    return media()
  })
  vi.stubGlobal('fetch', upstream)
  const responses = await Promise.all([request(), request()])
  expect(upstream).toHaveBeenCalledTimes(3)
  for (const response of responses) {
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.has('set-cookie')).toBe(false)
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([7, 1, 6])
  }
})

it('scopes pilot and compatibility objects to the server-selected paths', async () => {
  vi.stubEnv('WHIP_PILOT_CHANNEL', 'demo')
  state.status.mockResolvedValue({ live: true, hlsMediaPath: '_hls/channels/demo/active-source' })
  state.fallback = 'compat/demo'
  const paths: string[] = []
  vi.stubGlobal('fetch', async (url: URL) => {
    paths.push(url.pathname)
    return url.pathname.endsWith('/index.m3u8') ? master() : media()
  })
  expect((await request()).status).toBe(200)
  expect((await request(object, 'fallback')).status).toBe(200)
  expect(paths).toEqual(['/_hls/channels/demo/active-source/index.m3u8', '/_hls/channels/demo/active-source/' + object,
    '/compat/demo/index.m3u8', '/compat/demo/' + object])
})

it('rejects unsupported paths, ranges, queries, fallback and credentials before any upstream fetch', async () => {
  const upstream = vi.fn()
  vi.stubGlobal('fetch', upstream)
  for (const name of ['index.m3u8', 'gap.mp4', '0123456789ab_video1_init.mp4', '../' + object, 'https://elsewhere/' + object]) {
    expect((await request(name)).status).toBe(404)
  }
  expect((await request(object, 'another-channel')).status).toBe(404)
  expect((await request(object, 'fallback')).status).toBe(404)
  expect((await request(object, 'primary', '?session=foreign')).status).toBe(400)
  expect((await request(object, 'primary', '', { Range: 'bytes=0-1' })).status).toBe(416)
  expect((await request(object, 'primary', '', { Authorization: 'Bearer invalid' })).status).toBe(401)
  expect(upstream).not.toHaveBeenCalled()
})

it('withholds an object when the relay is revoked during the upstream read', async () => {
  vi.stubGlobal('fetch', async (url: URL) => {
    if (url.pathname.endsWith('/index.m3u8')) return master()
    state.paired = false
    return media()
  })
  expect((await request()).status).toBe(401)
})

it('bounds a chunked response without relying on its declared length', async () => {
  vi.stubGlobal('fetch', async (url: URL) => url.pathname.endsWith('/index.m3u8') ? master() :
    new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(16 * 1024 * 1024)); c.enqueue(new Uint8Array([1])); c.close() } }),
      { headers: { 'Content-Type': 'video/mp4' } }))
  expect((await request()).status).toBe(413)
})
