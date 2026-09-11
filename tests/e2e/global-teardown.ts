import { spawnSync } from 'node:child_process'

export default function globalTeardown(): void {
  spawnSync(
    'docker',
    ['rm', '--force', 'mediamtx-viewer-e2e-centrifugo'],
    { stdio: 'ignore' },
  )
}
