import Database from 'better-sqlite3'
import { resolve } from 'node:path'

const database = new Database(resolve(process.env.AUTH_DB_PATH ?? '.data/auth.sqlite'), {
  readonly: true,
})
const admin = database
  .prepare("SELECT 1 FROM user WHERE role = 'admin' AND activationStatus = 'active' LIMIT 1")
  .get()
database.close()

process.exitCode = admin ? 0 : 1

