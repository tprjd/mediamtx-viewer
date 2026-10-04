import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import Database from 'better-sqlite3'

export default function globalTeardown(): void {
  const database = new Database('.data/e2e-auth.sqlite', { fileMustExist: true })
  try {
    database.pragma('foreign_keys = ON')
    database.prepare("DELETE FROM user WHERE username GLOB 'e2e_new_*' AND email = username || '@example.test'").run()
  } finally { database.close() }
  rmSync('.data/e2e-chat-session.json', { force: true })
  spawnSync(
    'docker',
    ['rm', '--force', 'mediamtx-viewer-e2e-centrifugo'],
    { stdio: 'ignore' },
  )
}
