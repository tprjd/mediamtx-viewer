// Runs inside the candidate viewer, while the public maintenance proxy stays active.
import http from 'node:http'
import https from 'node:https'
import { lookup } from 'node:dns'
export async function verifyPrivateProxy(hostname) {
function request(path, headers = {}) {
  const url = new URL(path, hostname.startsWith(':') ? `http://caddy${hostname}` : `https://${hostname}`)
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http
    const req = transport.get(url, { headers, lookup: (_host, options, callback) => lookup('caddy', options, callback) }, response => {
      let body = ''
      response.on('data', chunk => { body += chunk; if (body.length > 2 * 1024 ** 2) req.destroy(new Error('Response too large')) })
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }))
    })
    req.setTimeout(5000, () => req.destroy(new Error('Proxy timed out')))
    req.on('error', reject)
  })
}
return verifyProxy(request)
}
export async function verifyProxy(request) {
  const login = await request('/login')
  if (login.status !== 200 || !login.headers['content-type']?.includes('text/html') ||
      !/name=["']username["']/.test(login.body) || !/name=["']password["']/.test(login.body)) throw new Error('Login route')
  const api = await request('/api/health')
  if (api.status !== 401) throw new Error('Protected API route')
  const document = await request('/api/health', { 'Sec-Fetch-Dest': 'document' })
  if (document.status !== 307 || document.headers.location !== '/login?returnTo=%2Fapi%2Fhealth') throw new Error('Protected document route')
}
