import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { getDatabase } from '@/lib/auth/database'

interface SourceLease { mediaPath: string; id: string; checkedAt: number }
const leases = globalThis as typeof globalThis & { __hlsSourceLease?: SourceLease }

function activeChannel() {
  return getDatabase().prepare(`SELECT c.media_path AS mediaPath, k.token_hash AS keyHash
    FROM channel c JOIN user u ON u.id=c.owner_user_id JOIN channel_stream_key k ON k.channel_id=c.id
    WHERE c.slug=? AND c.enabled=1 AND u.activationStatus='active' AND (u.emailVerified=1 OR u.legacyAccess=1)`)
    .get(process.env.WHIP_PILOT_CHANNEL ?? '') as { mediaPath: string; keyHash: string } | undefined
}

function currentJob(): HlsWorkerJob | undefined {
  const secret = process.env.HLS_WORKER_SECRET
  const lease = leases.__hlsSourceLease
  const channel = activeChannel()
  if (!secret || secret.length < 32 || !lease || Date.now() - lease.checkedAt > 5000 || channel?.mediaPath !== lease.mediaPath) return
  return { sourcePath: channel.mediaPath, outputPath: `_hls/${channel.mediaPath}/${lease.id}`, credential: createHmac('sha256', secret).update(JSON.stringify([channel.mediaPath, lease.id, channel.keyHash])).digest('hex') }
}

export interface HlsWorkerJob {
  sourcePath: string
  outputPath: string
  credential: string
}

export function workerSecretMatches(value: string | null): boolean {
  const secret = process.env.HLS_WORKER_SECRET
  if (!secret || secret.length < 32 || !value) return false
  const expected = Buffer.from(secret)
  const actual = Buffer.from(value)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** Authorization and the supervisor use the same current source snapshot.
 * The credential is scoped to this source, its derivative, and the current key. */
export async function getHlsWorkerJobs(): Promise<HlsWorkerJob[]> {
  const secret = process.env.HLS_WORKER_SECRET
  const slug = process.env.WHIP_PILOT_CHANNEL
  if (!slug || !secret || secret.length < 32) return []
  const channel = activeChannel()
  if (!channel) return []
  const origin = process.env.MEDIAMTX_API_URL ?? 'http://127.0.0.1:9997'
  const response = await fetch(`${origin}/v3/paths/list`, { cache: 'no-store', signal: AbortSignal.timeout(2500) })
  if (!response.ok) throw new Error('MediaMTX unavailable')
  const data = await response.json() as { items?: { name: string; ready: boolean; source?: { type: string; id: string }; tracks?: string[] }[] }
  leases.__hlsSourceLease = undefined
  const path = data.items?.find(path => path.name === channel.mediaPath)
  if (!path?.ready || path.source?.type !== 'webRTCSession' || !/^[a-zA-Z0-9_-]+$/.test(path.source.id) || !path.tracks?.includes('H264') || !path.tracks.includes('Opus')) return []
  leases.__hlsSourceLease = { mediaPath: channel.mediaPath, id: path.source.id, checkedAt: Date.now() }
  const job = currentJob()
  return job ? [job] : []
}

export async function authorizeHlsWorker(action: string, path: string, password: string): Promise<boolean> {
  if (!password) return false
  try {
    // Do not call the MediaMTX API from its authorization callback: publication
    // can hold the path lock. The supervisor refreshes this short lease each second.
    const job = currentJob()
    const jobs = job ? [job] : []
    return jobs.some(job => {
      const target = action === 'read' ? job.sourcePath : action === 'publish' ? job.outputPath : null
      const actual = Buffer.from(password)
      const expected = Buffer.from(job.credential)
      return target === path && actual.length === expected.length && timingSafeEqual(actual, expected)
    })
  } catch { return false }
}
