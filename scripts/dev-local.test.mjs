import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LOCAL_PORTS,
  formatLocalReadyMessage,
  prerequisiteErrors,
  selectLocalPorts,
} from './dev-local.mjs'

describe('local development stack', () => {
  it('selects the first available port upward without reusing a selected port', async () => {
    const occupied = new Set([3000, 3001, 1935, 8889, 8189])
    const ports = await selectLocalPorts({
      isAvailable: async (port) => !occupied.has(port),
    })

    expect(ports).toEqual({
      next: 3002,
      rtmp: 1936,
      hls: 8888,
      webrtc: 8890,
      api: 9997,
      ice: 8190,
    })
  })

  it('prints local login and OBS instructions without a stream key', () => {
    const output = formatLocalReadyMessage({
      ports: DEFAULT_LOCAL_PORTS,
      username: 'power',
      password: 'local-development-password',
    })

    expect(output).toContain('http://localhost:3000/login')
    expect(output).toContain('rtmp://localhost:1935')
    expect(output).toContain('Username: power')
    expect(output).toContain('Password: local-development-password')
    expect(output).toContain('/account/channel')
    expect(output).not.toContain('mtx_sk_')
  })

  it('requires Docker but does not require FFmpeg', () => {
    const calls = []
    expect(
      prerequisiteErrors({
        runner: (command, args) => {
          calls.push([command, args])
          return command === 'docker'
            ? { ok: true }
            : { ok: false, error: { code: 'ENOENT' } }
        },
      }),
    ).toEqual([])
    expect(calls).toEqual([
      ['docker', ['info', '--format', '{{.ServerVersion}}']],
    ])
  })
})
