// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getActiveSession, configurationErrors } = vi.hoisted(() => ({
  getActiveSession: vi.fn(),
  configurationErrors: vi.fn(),
}))
vi.mock('@/lib/auth/session', () => ({ getActiveSession }))
vi.mock('@/lib/auth/env', () => ({
  authEnvironment: { internalSecret: 'test-internal-secret' },
  getRuntimeConfigurationErrors: configurationErrors,
}))

import { GET } from '@/app/api/internal/authorize/route'

function request(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/internal/authorize', {
    headers: { 'x-internal-auth': 'test-internal-secret', ...headers },
  })
}

describe('proxy Viewing access', () => {
  beforeEach(() => {
    getActiveSession.mockReset().mockResolvedValue(null)
    configurationErrors.mockReset().mockReturnValue([])
  })

  it('rejects an untrusted caller before reading its session', async () => {
    expect((await GET(request({ 'x-internal-auth': 'wrong' }))).status).toBe(404)
    expect(getActiveSession).not.toHaveBeenCalled()
  })

  it('does not claim expired access when the session store is unavailable', async () => {
    getActiveSession.mockRejectedValueOnce(new Error('Database unavailable'))
    const response = await GET(request({ 'sec-fetch-dest': 'document', 'x-forwarded-method': 'GET' }))
    expect(response.status).toBe(503)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('does not authorize requests when configuration is invalid', async () => {
    configurationErrors.mockReturnValueOnce(['Missing secret'])
    expect((await GET(request())).status).toBe(503)
    expect(getActiveSession).not.toHaveBeenCalled()
  })

  it('uses the shared access decision and returns only identity headers', async () => {
    getActiveSession.mockResolvedValueOnce({ user: { id: 'viewer', role: 'user' } })
    const incoming = request({ cookie: 'test-cookie' })
    const response = await GET(incoming)
    expect(getActiveSession).toHaveBeenCalledWith(incoming.headers)
    expect(response.status).toBe(204)
    expect(response.headers.get('x-authenticated-user')).toBe('viewer')
    expect(response.headers.get('x-authenticated-role')).toBe('user')
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('returns 401 for media requests without Viewing access', async () => {
    const response = await GET(request({ 'sec-fetch-dest': 'video' }))
    expect(response.status).toBe(401)
    expect(response.headers.get('location')).toBeNull()
  })

  it('redirects document requests without Viewing access back through sign-in', async () => {
    const response = await GET(request({
      'sec-fetch-dest': 'document',
      'x-forwarded-method': 'GET',
      'x-forwarded-uri': '/watch/example',
    }))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('/login?returnTo=%2Fwatch%2Fexample')
  })
})
