// @vitest-environment node

import { expect, it } from 'vitest'
import { stagingFixture, inspect, docker } from './fixtures/staging-setup.mjs'

it('rejects retained enable safeguards and leaves Chat safely disabled', async () => {
  await stagingFixture(async ({ command, fault, project, viewer }) => {
    const deployed = await command('managed')
    expect(deployed.status, deployed.stderr + deployed.diagnostic).toBe(0)
    for (const failure of ['stale', 'checks', 'tag', 'digest', 'image-source', 'architecture', 'host-architecture',
      'host-memory', 'host-cpu', 'host-space', 'database-limit', 'broker-health', 'degraded-chat']) {
      fault(failure)
      const result = await command('chat-enable')
      expect(result.status, failure + result.stdout).not.toBe(0)
      expect(JSON.parse(result.stderr || result.stdout), failure).toMatchObject({ result: 'failed-disabled', chatEnabled: false })
      expect(inspect(`${project}-centrifugo-1`).State.Running, failure).toBe(false)
      fault('')
      expect(JSON.parse((await command('chat-health')).stdout).chat.status, failure).toBe('disabled')
    }
    expect(JSON.parse((await command('status')).stdout)).toMatchObject({ result: 'failed-disabled', owner: 'none', chatEnabled: false })
    for (const reference of [null, 'missing-message']) {
      docker('exec', viewer, 'node', '-e', "const D=require('better-sqlite3');const d=new D('/data/chat.sqlite');d.pragma('foreign_keys=OFF');d.prepare('INSERT INTO chat_outbox(id,message_id,channel_name,payload,next_attempt_at,created_at) VALUES (?,?,?,?,0,0)').run('blocked',JSON.parse(process.argv[1]),'room','{}')", JSON.stringify(reference))
      const result = await command('chat-enable')
      expect(result.status).not.toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ result: 'failed-disabled', reason: 'Database integrity or Chat outbox check failed' })
      docker('exec', viewer, 'node', '-e', "const D=require('better-sqlite3');new D('/data/chat.sqlite').exec('DELETE FROM chat_outbox')")
    }
  }, { managed: true })
}, 600000)
