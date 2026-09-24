// Read both real migration histories. No migration or live database write occurs.
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
const input = JSON.parse(process.argv[2])
try {
  const result = {}
  for (const [name, folder] of [['auth', 'migrations'], ['chat', 'chat-migrations']]) {
    const db = new Database(input.paths[name], { readonly: true, fileMustExist: true })
    try {
      if (db.pragma('integrity_check', { simple: true }) !== 'ok' || db.pragma('foreign_key_check').length) throw new Error('Integrity')
      if (name === 'chat' && input.requireDrained && db.prepare('SELECT count(*) AS n FROM chat_outbox').get().n !== 0) throw new Error('Pending deliveries')
      const rows = db.prepare('SELECT name, applied_at FROM app_migration ORDER BY name').all()
      const files = root => readdirSync(join(root, folder)).filter(file => file.endsWith('.sql')).sort().map(file => ({
        name: file, hash: createHash('sha256').update(readFileSync(join(root, folder, file))).digest('hex'),
      }))
      const previous = files(input.previous)
      const candidate = files(input.candidate)
      if (!rows.length || JSON.stringify(rows.map(row => row.name)) !== JSON.stringify(previous.map(file => file.name)) ||
          JSON.stringify(previous) !== JSON.stringify(candidate)) throw new Error('History')
      result[name] = rows
    } finally { db.close() }
  }
  console.log(JSON.stringify(result))
} catch { console.error('Database migration state is uncertain, altered, or requires migrations'); process.exitCode = 1 }
