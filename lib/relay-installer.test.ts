// @vitest-environment node
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { relayHelperHash } from './relay-helper'
import { buildRelayInstaller, RELAY_INSTALLER_VERSION } from './relay-installer'

const origin = 'https://stream.example'
const ticket = 'mtx_rp_' + 'x'.repeat(43)

describe('Windows Channel relay download', () => {
  it.each([
    [origin, 'wheps://stream.example'],
    ['http://localhost:3000', 'whep://localhost:3000'],
    ['http://127.0.0.1:8080', 'whep://127.0.0.1:8080'],
    ['http://[::1]:3000', 'whep://[::1]:3000'],
  ])('builds a hash-checked download for %s with the matching media source', (origin, mediaOrigin) => {
    const launcher = buildRelayInstaller({ origin, ticket }).toString('ascii')
    expect(RELAY_INSTALLER_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    expect(launcher).toContain(`title FrankerzSpam Channel relay v${RELAY_INSTALLER_VERSION}\r\n`)
    const encoded = launcher.split('\r\n:__CHANNEL_RELAY_PAYLOAD__\r\n').at(-1)!
    const script = Buffer.from(encoded, 'base64')
    expect(launcher).toContain(createHash('sha256').update(script).digest('hex'))
    expect(launcher).not.toContain(ticket)
    const bootstrap = script.toString('utf8').match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/)![1]
    expect(JSON.parse(Buffer.from(bootstrap, 'base64').toString('utf8'))).toEqual({
      origin, ticket, relayVersion: RELAY_INSTALLER_VERSION, sourceUrl: mediaOrigin + '/api/relay/source/whep', helperHash: relayHelperHash(),
    })
    expect(script.toString('utf8')).not.toContain('__RELAY_BOOTSTRAP__')
  })

  it('rejects other HTTP hosts, noncanonical origins and invalid tickets', () => {
    for (const invalid of [
      'http://stream.example', 'http://localhost.example', 'http://192.168.1.5', 'http://127.0.0.2',
      'http://127.1', 'http://[::ffff:7f00:1]', 'http://localhost.', 'ftp://localhost',
      'http://user@localhost', 'http://localhost?port=3000', origin + '/path', 'https://user@stream.example',
    ]) {
      expect(() => buildRelayInstaller({ origin: invalid, ticket })).toThrow()
    }
    expect(() => buildRelayInstaller({ origin, ticket: 'x\r\nwhoami' })).toThrow()
  })
})
