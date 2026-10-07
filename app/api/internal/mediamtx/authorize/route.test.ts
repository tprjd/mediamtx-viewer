// @vitest-environment node
import { expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/env', () => ({ authEnvironment: { mediaMtxAuthSecret: 'test-secret' } }))
vi.mock('@/lib/channels', () => ({ authorizePublish: (path: string, token: string) => path === 'live' && token === 'valid-publish-key' }))
import { POST } from './route'
const call = (action: string, protocol: string, token = '') => POST(new Request('http://localhost/api/internal/mediamtx/authorize?secret=test-secret', { method: 'POST', body: JSON.stringify({ action, protocol, path: 'live', token }) }))
it('blocks RTMP readers even with a valid publishing key', async () => {
  expect((await call('read', 'rtmp')).status).toBe(403)
  expect((await call('read', 'rtmp', 'valid-publish-key')).status).toBe(403)
  expect((await call('read', '')).status).toBe(403)
  expect((await call('publish', 'rtmp', 'valid-publish-key')).status).toBe(204)
  expect((await call('publish', 'rtmp', 'invalid')).status).toBe(401)
})
it('keeps private thumbnail reads and protected web readers available', async () => {
  for (const protocol of ['rtsp', 'hls', 'webrtc']) expect((await call('read', protocol)).status).toBe(204)
})
