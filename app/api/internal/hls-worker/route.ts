import { getHlsWorkerJobs, workerSecretMatches } from '@/lib/hls-worker'
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  if (!workerSecretMatches(request.headers.get('x-hls-worker-secret'))) return new Response(null, { status: 404 })
  try {
    return Response.json({ jobs: await getHlsWorkerJobs() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
