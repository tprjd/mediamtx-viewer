import 'server-only'
import { createHash, randomInt } from 'node:crypto'
import { getActiveSession } from '@/lib/auth/session'
import { checkMediaPath } from '@/lib/viewing-access'

type Identity = { status: 204; userId: string; role: string }
type Decision = Identity | { status: 401 | 403 } | { status: 503; error?: unknown }
type FullCheck = { decision: Decision; directory?: string; sessionEnd?: number }
type Grant = { identity: Identity; deadline: number; sessionEnd: number }
type Pending = { deadline: number; result: Promise<Decision> }

const processState = globalThis as typeof globalThis & {
  hlsViewingAccess?: { grants: Map<string, Grant>; pending: Map<string, Pending>; activeChecks: number }
}
const cache = processState.hlsViewingAccess ??= { grants: new Map(), pending: new Map(), activeChecks: 0 }
const { grants, pending } = cache
const maxGrants = 1024
const maxPending = 64

async function fullCheck(headers: Headers, uri: string): Promise<FullCheck> {
  let session
  try { session = await getActiveSession(headers) }
  catch (error) { return { decision: { status: 503, error } } }
  if (!session) return { decision: { status: 401 } }
  const sessionEnd = new Date(session.session.expiresAt).getTime()
  if (sessionEnd <= Date.now()) return { decision: { status: 401 } }
  const access = checkMediaPath(session.user.id, uri)
  if (!access.allowed) return { decision: { status: 403 } }
  return {
    decision: { status: 204, userId: session.user.id, role: session.user.role ?? 'user' },
    directory: access.hlsDirectory,
    sessionEnd,
  }
}

/** Only ordinary, unescaped HLS objects can reuse an approval for their directory. */
function hlsDirectory(uri: string, method: string | null): string | undefined {
  if (method !== 'GET' && method !== 'HEAD') return
  const path = uri.split('?', 1)[0]
  if (path.length > 512 || path.includes('..') || path.includes('/./')) return
  return /^(\/media\/hls\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+)\/[A-Za-z0-9_-][A-Za-z0-9._-]*\.(?:m3u8|mp4|m4s|ts)$/.exec(path)?.[1]
}

export async function authorizeMediaRequest(headers: Headers, method: string | null, uri: string): Promise<Decision> {
  const directory = hlsDirectory(uri, method)
  const cookie = headers.get('cookie')
  if (!directory || !cookie) return (await fullCheck(headers, uri)).decision

  const key = createHash('sha256').update(cookie).digest('hex') + directory
  const now = performance.now()
  const grant = grants.get(key)
  if (grant && now < grant.deadline && Date.now() < grant.sessionEnd) return grant.identity
  grants.delete(key)
  const previous = pending.get(key)
  if (previous && now < previous.deadline) return previous.result
  if (cache.activeChecks >= maxPending) return { status: 503 }

  const deadline = now + randomInt(4000, 5001)
  cache.activeChecks++
  const result = fullCheck(headers, uri).then(({ decision, directory: checkedDirectory, sessionEnd }) => {
    if (decision.status === 204 && directory === checkedDirectory && sessionEnd &&
        pending.get(key)?.result === result && performance.now() < deadline && Date.now() < sessionEnd) {
      if (grants.size >= maxGrants) grants.delete(grants.keys().next().value!)
      grants.set(key, { identity: decision, deadline, sessionEnd })
    }
    return decision
  }).finally(() => {
    cache.activeChecks--
    if (pending.get(key)?.result === result) pending.delete(key)
  })
  pending.set(key, { deadline, result })
  return result
}
