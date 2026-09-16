// @vitest-environment node
import Database from 'better-sqlite3'
import { readdirSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { purgeExpiredChat } from './chat-retention.mjs'

it('purges expired messages, removed content, notes, and queued content while keeping structured records', () => {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  for (const file of readdirSync('chat-migrations').sort())
    db.exec(readFileSync(`chat-migrations/${file}`, 'utf8'))
  const now = Date.now()
  const expired = now - 7 * 86400000 - 1
  db.prepare('INSERT INTO chat_room VALUES (?, ?, ?, ?)').run(
    'room',
    'channel',
    4,
    expired,
  )
  const message = db.prepare(`INSERT INTO chat_message
    (id, room_id, room_sequence, account_id, profile_name, author_tag, content, created_at, removed_sequence)
    VALUES (?, 'room', ?, 'account', 'Name', 'abcd', ?, ?, ?)`)
  message.run('old', 1, 'expired text', expired, null)
  message.run('removed', 2, 'removed text', expired, 4)
  message.run('retained', 3, 'current text', now, null)
  db.prepare(
    `INSERT INTO chat_outbox VALUES ('event', 'old', 'chat:channel', 'expired text', 0, 0, ?)`,
  ).run(expired)
  db.prepare(
    `INSERT INTO chat_moderation_record
    (id, action, category, actor_account_id, target_account_id, room_id, message_id, private_note, created_at)
    VALUES ('record', 'message_removal', 'Spam', 'actor', 'account', 'room', 'removed', 'private text', ?)`,
  ).run(expired)
  purgeExpiredChat(db, now)
  expect(db.prepare('SELECT id FROM chat_message').all()).toEqual([
    { id: 'retained' },
  ])
  expect(db.prepare('SELECT * FROM chat_outbox').all()).toEqual([])
  expect(
    db
      .prepare(
        'SELECT action, category, private_note FROM chat_moderation_record',
      )
      .get(),
  ).toEqual({
    action: 'message_removal',
    category: 'Spam',
    private_note: null,
  })
  db.close()
})
