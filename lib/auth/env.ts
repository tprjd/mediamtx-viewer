const DEVELOPMENT_SECRET = 'development-only-secret-change-before-production'
const BUILD_SECRET = 'build-only-secret-never-used-by-the-running-server'

function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === 'phase-production-build'
}

export const authEnvironment = {
  baseUrl: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  databasePath: process.env.AUTH_DB_PATH ?? '.data/auth.sqlite',
  internalSecret:
    process.env.INTERNAL_AUTH_SECRET ??
    (process.env.NODE_ENV === 'production' ? '' : DEVELOPMENT_SECRET),
  mediaMtxAuthSecret:
    process.env.MEDIAMTX_AUTH_SECRET ??
    (process.env.NODE_ENV === 'production' ? '' : DEVELOPMENT_SECRET),
  secret:
    process.env.BETTER_AUTH_SECRET ??
    (isBuildPhase()
      ? BUILD_SECRET
      : process.env.NODE_ENV === 'production'
        ? BUILD_SECRET
        : DEVELOPMENT_SECRET),
}

export function getRuntimeConfigurationErrors(): string[] {
  if (process.env.NODE_ENV !== 'production' || isBuildPhase()) return []

  const errors: string[] = []
  if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) {
    errors.push('BETTER_AUTH_SECRET must contain at least 32 characters')
  }
  if (!process.env.INTERNAL_AUTH_SECRET || process.env.INTERNAL_AUTH_SECRET.length < 32) {
    errors.push('INTERNAL_AUTH_SECRET must contain at least 32 characters')
  }
  if (!process.env.MEDIAMTX_AUTH_SECRET || process.env.MEDIAMTX_AUTH_SECRET.length < 32) {
    errors.push('MEDIAMTX_AUTH_SECRET must contain at least 32 characters')
  }
  try {
    const url = new URL(process.env.BETTER_AUTH_URL ?? '')
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol !== 'https:' && !local) {
      errors.push('BETTER_AUTH_URL must be an HTTPS origin')
    }
  } catch {
    errors.push('BETTER_AUTH_URL must be an absolute URL')
  }
  return errors
}
