// Executed with node -e in the running viewer. No migration or write statement runs.
import Database from 'better-sqlite3'
import { statSync } from 'node:fs'
try {
  const input = JSON.parse(process.argv[1])
  let databaseBytes = 0
  for (const [name, path] of Object.entries(input.databases)) {
    const db = new Database(path, { readonly: true, fileMustExist: true, timeout: 1000 })
    try {
      if (db.pragma('integrity_check', { simple: true }) !== 'ok' || db.pragma('foreign_key_check').length) throw new Error('Database integrity failed')
      db.prepare('SELECT name FROM app_migration ORDER BY name').all()
      const logicalBytes = db.pragma('page_count', { simple: true }) * db.pragma('page_size', { simple: true })
      let fileBytes = 0
      for (const suffix of ['', '-wal']) {
        try { fileBytes += statSync(path + suffix).size } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
      const bytes = Math.max(logicalBytes, fileBytes)
      if (name === 'chat') {
        const depth = db.prepare('SELECT count(*) AS n FROM chat_outbox').get().n
        if (!Number.isSafeInteger(depth) || depth < 0 || bytes >= input.databaseLimitBytes) throw new Error('Chat runtime storage check failed')
      }
      databaseBytes += bytes
    } finally { db.close() }
  }
  console.log(JSON.stringify({ databaseBytes }))
} catch {
  console.error('Database integrity or runtime storage check failed')
  process.exitCode = 1
}
