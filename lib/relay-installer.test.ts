// @vitest-environment node
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { buildRelayInstaller } from './relay-installer'

const origin = 'https://stream.example'
const ticket = 'mtx_rp_' + 'x'.repeat(43)

describe('Windows Channel relay download', () => {
  it('embeds the site and ticket as data in the hash-checked PowerShell payload', () => {
    const launcher = buildRelayInstaller({ origin, ticket }).toString('ascii')
    const encoded = launcher.split('\r\n:__CHANNEL_RELAY_PAYLOAD__\r\n').at(-1)!
    const script = Buffer.from(encoded, 'base64')
    expect(launcher).toContain(createHash('sha256').update(script).digest('hex'))
    expect(launcher).not.toContain(ticket)
    const bootstrap = script.toString('utf8').match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/)![1]
    expect(JSON.parse(Buffer.from(bootstrap, 'base64').toString('utf8'))).toEqual({ origin, ticket })
    expect(script.toString('utf8')).not.toContain('__RELAY_BOOTSTRAP__')
  })

  it('accepts only a bare HTTPS origin and a token-safe ticket', () => {
    for (const invalid of ['http://stream.example', origin + '/path', 'https://user@stream.example']) {
      expect(() => buildRelayInstaller({ origin: invalid, ticket })).toThrow()
    }
    expect(() => buildRelayInstaller({ origin, ticket: 'x\r\nwhoami' })).toThrow()
  })
})
