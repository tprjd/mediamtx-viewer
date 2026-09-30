import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'

export default function globalTeardown(): void {
  rmSync('.data/e2e-chat-session.json', { force: true })
  spawnSync(
    'docker',
    ['rm', '--force', 'mediamtx-viewer-e2e-centrifugo'],
    { stdio: 'ignore' },
  )
}
