import { createServer } from 'node:http'
import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
const db = new Database(process.env.CHAT_DB_PATH)
db.pragma('journal_mode = WAL')
db.exec(`CREATE TABLE IF NOT EXISTS fixture_writes (id INTEGER PRIMARY KEY, source TEXT);
  INSERT OR IGNORE INTO chat_room (id, channel_id, next_sequence, created_at) VALUES ('room', 'channel', 2, 0);
  INSERT OR IGNORE INTO chat_message (id, room_id, room_sequence, account_id, profile_name, author_tag, content, created_at)
  VALUES ('old', 'room', 1, 'account', 'Name', 'tag1', 'expired fixture content', 0)`)
setInterval(() => db.prepare('INSERT INTO fixture_writes (source) VALUES (?)').run('background'), 100)
createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json')
  if (request.url === '/api/health') {
    response.end(JSON.stringify({ status: 'ok', version: 'fixture', chat: {
      status: process.env.CHAT_ENABLED === 'true' ? (existsSync('/data/unhealthy') ? 'degraded' : 'healthy') : 'disabled',
    } }))
  } else {
    db.prepare('INSERT INTO fixture_writes (source) VALUES (?)').run('public')
    response.end(JSON.stringify({ writes: db.prepare('SELECT count(*) AS n FROM fixture_writes').get().n,
      expired: db.prepare('SELECT count(*) AS n FROM chat_message').get().n }))
  }
}).listen(3000, '0.0.0.0')
