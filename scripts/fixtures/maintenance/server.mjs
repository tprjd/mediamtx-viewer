import { createServer } from 'node:http'
import Database from 'better-sqlite3'
import { chmodSync, existsSync } from 'node:fs'
const auth = new Database(process.env.AUTH_DB_PATH)
auth.exec(`INSERT OR IGNORE INTO user (id, name, email, emailVerified, createdAt, updatedAt, role, activationStatus)
  VALUES ('account', 'Name', 'fixture@example.test', 0, 0, 0, 'admin', 'active');
  INSERT OR IGNORE INTO channel (id, owner_user_id, slug, media_path, display_name, title, enabled, created_at, updated_at)
  VALUES ('channel', 'account', 'fixture', 'fixture', 'Fixture', 'Fixture', 1, 0, 0)`)
auth.close()
const db = new Database(process.env.CHAT_DB_PATH)
db.pragma('journal_mode = WAL')
const seeded = db.prepare("SELECT 1 FROM sqlite_master WHERE name='fixture_writes'").get()
if (!seeded) db.exec(`CREATE TABLE IF NOT EXISTS fixture_writes (id INTEGER PRIMARY KEY, source TEXT);
  INSERT OR IGNORE INTO chat_room (id, channel_id, next_sequence, created_at) VALUES ('room', 'channel', 2, 0);
  INSERT OR IGNORE INTO chat_message (id, room_id, room_sequence, account_id, profile_name, author_tag, content, created_at)
  VALUES ('old', 'room', 1, 'account', 'Name', 'tag1', 'expired fixture content', 0)`)
if (process.env.FIXTURE_FAILURE === 'volume-ownership') chmodSync(process.env.CHAT_DB_PATH, 0o600)
if (process.env.FIXTURE_FAILURE === 'migration-history') db.exec('UPDATE app_migration SET applied_at = applied_at + 1')
setInterval(() => db.prepare('INSERT INTO fixture_writes (source) VALUES (?)').run('background'), 100)
createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json')
  if (request.url === '/login') {
    response.setHeader('Content-Type', 'text/html')
    response.end('<form><input name="username"><input name="password"></form>')
  } else if (['/api/health', '/_fixture-health'].includes(request.url)) {
    response.end(JSON.stringify({ status: 'ok', version: process.env.FIXTURE_VERSION || 'fixture', chat: {
      status: process.env.CHAT_ENABLED === 'true' ? ((existsSync('/data/unhealthy') || process.env.FIXTURE_FAILURE === 'degraded-chat') ? 'degraded' : 'healthy') : 'disabled',
    } }))
  } else {
    db.prepare('INSERT INTO fixture_writes (source) VALUES (?)').run('public')
    response.end(JSON.stringify({ writes: db.prepare('SELECT count(*) AS n FROM fixture_writes').get().n,
      expired: db.prepare('SELECT count(*) AS n FROM chat_message').get().n }))
  }
}).listen(3000, '0.0.0.0')
