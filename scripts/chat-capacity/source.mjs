import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export function sourceFingerprint() {
  const hash = createHash('sha256')
  const visit = path => {
    for (const entry of readdirSync(path, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) visit(child)
      else if (entry.isFile()) {hash.update(child); hash.update('\0'); hash.update(readFileSync(child)); hash.update('\0')}
    }
  }
  for (const path of ['app', 'components', 'hooks', 'lib', 'scripts', 'config', 'migrations', 'chat-migrations', 'tests', 'public'])
    if (existsSync(path)) visit(path)
  for (const path of ['package.json', 'package-lock.json', 'Dockerfile', 'next.config.ts', 'tsconfig.json',
    'playwright.config.ts', 'vitest.config.ts', 'instrumentation.ts', '.dockerignore',
    'deploy/oracle/deploy.sh', 'deploy/oracle/chat-rollout.sh', 'deploy/oracle/docker-compose.yml', 'deploy/oracle/Caddyfile']) {
    hash.update(path); hash.update('\0'); hash.update(readFileSync(path)); hash.update('\0')
  }
  return hash.digest('hex')
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) console.log(sourceFingerprint())
