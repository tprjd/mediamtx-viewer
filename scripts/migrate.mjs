import Database from 'better-sqlite3'
import { readdirSync, readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const databasePath = process.env.AUTH_DB_PATH ?? join(projectRoot, '.data/auth.sqlite')
const migrationsPath = join(projectRoot, 'migrations')

mkdirSync(dirname(databasePath), { recursive: true })
const database = new Database(databasePath)
database.pragma('journal_mode = WAL')
database.pragma('foreign_keys = ON')
database.pragma('busy_timeout = 5000')
database.exec(`
  CREATE TABLE IF NOT EXISTS app_migration (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )
`)

const applyMigration = database.transaction((name, sql) => {
  database.exec(sql)
  database
    .prepare('INSERT INTO app_migration (name, applied_at) VALUES (?, ?)')
    .run(name, Date.now())
})

for (const name of readdirSync(migrationsPath).filter((file) => file.endsWith('.sql')).sort()) {
  const applied = database
    .prepare('SELECT 1 FROM app_migration WHERE name = ?')
    .get(name)
  if (applied) continue
  applyMigration(name, readFileSync(join(migrationsPath, name), 'utf8'))
  process.stdout.write(`Applied ${name}\n`)
}

database.close()

