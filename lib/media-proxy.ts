import 'server-only'
import { authorizeMediaRequest } from '@/lib/media-authorization'

export async function proxyMedia(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const access = await authorizeMediaRequest(request.headers, request.method, url.pathname)
  if (access.status === 503 && 'error' in access) throw access.error
  if (access.status !== 204) return new Response(null, { status: access.status, headers: { 'Cache-Control': 'no-store' } })
  const hls = url.pathname.startsWith('/media/hls/')
  const origin = hls ? process.env.MEDIAMTX_HLS_URL ?? 'http://127.0.0.1:8888' : process.env.MEDIAMTX_WEBRTC_URL ?? 'http://127.0.0.1:8889'
  const prefix = hls ? '/media/hls' : '/media/whep'
  const upstream = new URL(origin)
  upstream.pathname = url.pathname.slice(prefix.length)
  upstream.search = url.search
  if (!hls) {
    upstream.searchParams.delete('frankerzspam_internal')
    upstream.searchParams.delete('relay_generation')
  }
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
