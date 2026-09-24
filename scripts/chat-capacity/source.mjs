import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export function sourceFingerprint() {
  const hash = createHash('sha256')
  const visit = path => {
    for (const entry of readdirSync(path, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(path, entry.name)
      if (path === 'deploy/oracle' && ['secrets', 'secrets.enc', 'terraform'].includes(entry.name)) continue
      if (entry.isDirectory()) visit(child)
      else if (entry.isFile()) {hash.update(child); hash.update('\0'); hash.update(readFileSync(child)); hash.update('\0')}
    }
  }
  for (const path of ['app', 'components', 'hooks', 'lib', 'scripts', 'config', 'migrations', 'chat-migrations', 'tests', 'public', 'deploy/oracle', '.github/workflows'])
    if (existsSync(path)) visit(path)
  for (const path of ['package.json', 'package-lock.json', 'Dockerfile', 'next.config.ts', 'next-env.d.ts', 'tsconfig.json',
    'playwright.config.ts', 'vitest.config.ts', 'vitest.setup.ts', 'eslint.config.mjs', 'postcss.config.mjs',
    'instrumentation.ts', '.dockerignore', 'docker-compose.yml']) {
    if (!existsSync(path)) continue
    hash.update(path); hash.update('\0'); hash.update(readFileSync(path)); hash.update('\0')
  }
  return hash.digest('hex')
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(sourceFingerprint())
