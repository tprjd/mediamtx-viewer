import 'server-only'
import { getActiveSession } from '@/lib/auth/session'
import { canRequestMedia } from '@/lib/viewing-access'

export async function proxyMedia(request: Request): Promise<Response> {
  const session = await getActiveSession(request.headers)
  const url = new URL(request.url)
  if (!session || !canRequestMedia(session.user.id, url.pathname)) return new Response(null, { status: session ? 403 : 401, headers: { 'Cache-Control': 'no-store' } })
  const hls = url.pathname.startsWith('/media/hls/')
  const origin = hls ? process.env.MEDIAMTX_HLS_URL ?? 'http://127.0.0.1:8888' : process.env.MEDIAMTX_WEBRTC_URL ?? 'http://127.0.0.1:8889'
  const prefix = hls ? '/media/hls' : '/media/whep'
  const upstream = new URL(origin)
  upstream.pathname = url.pathname.slice(prefix.length)
  upstream.search = url.search
  const headers = new Headers(request.headers)
  for (const name of ['cookie', 'authorization', 'host', 'connection', 'transfer-encoding', 'content-length']) headers.delete(name)
  try {
    const response = await fetch(upstream, {
      method: request.method, headers, redirect: 'manual', cache: 'no-store', signal: request.signal,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
    })
    const outputHeaders = new Headers(response.headers)
    for (const name of ['connection', 'transfer-encoding', 'set-cookie', 'content-encoding', 'content-length']) outputHeaders.delete(name)
    outputHeaders.set('Cache-Control', 'private, no-store')
    const location = outputHeaders.get('location')
    if (location) outputHeaders.set('location', `${prefix}${new URL(location, upstream).pathname}`)
    return new Response(response.body, { status: response.status, headers: outputHeaders })
  } catch { return new Response(null, { status: 502, headers: { 'Cache-Control': 'no-store' } }) }
}
