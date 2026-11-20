// @vitest-environment node
import Database from 'better-sqlite3'
import { createHmac, randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { createServer, type IncomingHttpHeaders } from 'node:http'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const database = new Database(':memory:')
vi.mock('@/lib/auth/database', () => ({ getDatabase: () => database }))

const origin = 'https://watch.example.test'
const secret = 'test-only-better-auth-secret-32-characters'
const offer = 'v=0\r\no=- 123 1 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n'
const remoteId = randomUUID()
const calls: {url: URL; method: string; headers: IncomingHttpHeaders; body: string}[] = []
let afterSourceOffer: (() => void) | undefined
const upstream = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  const url = new URL(req.url!, 'http://upstream.invalid')
  calls.push({ url, method: req.method!, headers: req.headers, body: Buffer.concat(chunks).toString() })
  if (req.method === 'POST') {
    afterSourceOffer?.()
    res.writeHead(201, {
      Location: url.pathname + '/' + remoteId,
      'Content-Type': 'application/sdp',
      'Set-Cookie': 'private-upstream-cookie=test',
    })
    res.end(offer)
  } else {
    res.writeHead(204)
    res.end()
  }
})

let pair: typeof import('@/app/api/relay/pair/route').POST
let poll: typeof import('@/app/api/relay/poll/route').POST
let download: typeof import('@/app/account/channel/relay.cmd/route').POST
let whep: typeof import('@/app/api/channels/[slug]/relay/whep/[[...resource]]/route').POST
let source: typeof import('@/app/api/relay/source/whep/[[...resource]]/route').POST
let cookieName: string

beforeAll(async () => {
  vi.stubEnv('BETTER_AUTH_URL', origin)
  vi.stubEnv('BETTER_AUTH_SECRET', secret)
  vi.stubEnv('INTERNAL_AUTH_SECRET', 'test-only-relay-source-signature-key')
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const address = upstream.address()
  if (!address || typeof address === 'string') throw new Error('No test server port')
  vi.stubEnv('MEDIAMTX_WEBRTC_URL', 'http://127.0.0.1:' + address.port)
  database.pragma('foreign_keys = ON')
  for (const file of readdirSync('migrations').filter(f => f.endsWith('.sql')).sort()) {
    database.exec(readFileSync('migrations/' + file, 'utf8'))
  }
  pair = (await import('@/app/api/relay/pair/route')).POST
  poll = (await import('@/app/api/relay/poll/route')).POST
  download = (await import('@/app/account/channel/relay.cmd/route')).POST
  whep = (await import('@/app/api/channels/[slug]/relay/whep/[[...resource]]/route')).POST
  source = (await import('@/app/api/relay/source/whep/[[...resource]]/route')).POST
  const { auth } = await import('./auth/auth')
  cookieName = (await auth.$context).authCookies.sessionToken.name
})

afterAll(async () => {
  await new Promise<void>(resolve => upstream.close(() => resolve()))
  database.close()
  vi.unstubAllEnvs()
})

function account() {
  const id = randomUUID()
  database.prepare(`INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt,activationStatus)
    VALUES (?,?,?,1,0,0,'active')`).run(id,id,id + '@example.test')
  const token = randomUUID()
  database.prepare('INSERT INTO session (id,userId,token,createdAt,updatedAt,expiresAt) VALUES (?,?,?,?,?,?)')
    .run(randomUUID(), id, token, Date.now(), Date.now(), Date.now() + 60_000)
  const signature = createHmac('sha256', secret).update(token).digest('base64')
  return { id, cookie: cookieName + '=' + encodeURIComponent(token + '.' + signature) }
}

function json(path: string, body: unknown, credential?: string) {
  return new Request(origin + path, {method:'POST', headers:{
    'Content-Type':'application/json', ...(credential ? {Authorization:'Bearer ' + credential} : {}),
  }, body:JSON.stringify(body)})
}

async function pairDownload(owner: ReturnType<typeof account>) {
  const response = await download(new Request(origin + '/account/channel/relay.cmd', {
    method:'POST', headers:{ Origin:origin, Cookie:owner.cookie },
  }))
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toContain('no-store')
  const cmd = await response.text()
  const script = Buffer.from(cmd.split(':__CHANNEL_RELAY_PAYLOAD__').at(-1)!, 'base64').toString()
  const encoded = script.match(/\$bootstrap = [^\n]*FromBase64String\('([A-Za-z0-9+/=]+)'\)/)?.[1]
  expect(encoded).toBeDefined()
  const {ticket} = JSON.parse(Buffer.from(encoded!, 'base64').toString())
  const paired = await pair(json('/api/relay/pair',{ticket}))
  expect(paired.status).toBe(200)
  expect((await pair(json('/api/relay/pair',{ticket}))).status).toBe(401)
  return await paired.json() as {credential:string;channelSlug:string;mediaPath:string}
}

it('requires a signed-in owner at the site origin to download a single-use pairing ticket', async () => {
  const owner = account()
  const path = origin + '/account/channel/relay.cmd'
  expect((await download(new Request(path, {method:'POST',headers:{Origin:origin}}))).status).toBe(401)
  expect((await download(new Request(path, {method:'POST',headers:{Origin:'https://other.test',Cookie:owner.cookie}}))).status).toBe(403)
  const relay = await pairDownload(owner)
  expect((await poll(json('/api/relay/poll', {}, 'not-a-relay-credential'))).status).toBe(401)
  expect((await poll(json('/api/relay/poll', {}, relay.credential))).status).toBe(400)
})

it('applies Viewing access and routes an authorized browser offer and answer through the real poll handler', async () => {
  const owner = account()
  const viewer = account()
  const relay = await pairDownload(owner)
  const instanceId = randomUUID()
  const pollRequest = (sessions: string[] = [], replies: {id:string;status:number;body:string}[] = []) =>
    poll(json('/api/relay/poll', {instanceId,sessions,replies},relay.credential))
  expect((await pollRequest()).status).toBe(200)
  const context = { params:Promise.resolve({slug:relay.channelSlug}) }
  const url = origin + '/api/channels/' + relay.channelSlug + '/relay/whep'
  const post = (cookie: string) => whep(new Request(url, {method:'POST',headers:{Cookie:cookie,'Content-Type':'application/sdp'},body:offer}), context)
  expect((await post('')).status).toBe(401)
  expect((await post(viewer.cookie)).status).toBe(403)
  database.prepare('UPDATE user SET administratorApproved=1 WHERE id=?').run(viewer.id)
  const created = post(viewer.cookie)
  let command: {id:string;sessionId:string;body:string;method:string} | undefined
  await vi.waitFor(async () => {
    const {commands} = await (await pollRequest()).json()
    command = commands[0]
    expect(command).toBeDefined()
  })
  expect(command).toMatchObject({method:'POST',body:offer})
  expect(JSON.stringify(command)).not.toContain(viewer.cookie)
  await pollRequest([command!.sessionId], [{id:command!.id,status:201,body:offer}])
  const result = await created
  expect(result.status).toBe(201)
  expect(await result.text()).toBe(offer)
  expect(result.headers.get('location')).toBe(new URL(url).pathname + '/' + command!.sessionId)
  const resource = {params:Promise.resolve({slug:relay.channelSlug,resource:[command!.sessionId]})}
  expect((await whep(new Request(url,{method:'DELETE',headers:{Cookie:owner.cookie}}),resource)).status).toBe(404)
  expect((await whep(new Request(url,{method:'DELETE',headers:{Cookie:viewer.cookie}}),resource)).status).toBe(204)
  expect((await (await pollRequest([command!.sessionId])).json()).commands[0]).toMatchObject({method:'DELETE',sessionId:command!.sessionId})
})

function sourceRequest(method: string, relayCredential: string, resource?: string) {
  const headers = {
    Authorization:'Bearer ' + relayCredential, Cookie:'viewer-secret=fixture', 'X-Internal-Auth':'fixture-internal',
    'Content-Type':method === 'PATCH' ? 'application/trickle-ice-sdpfrag' : 'application/sdp', 'If-Match':'*',
  }
  const body = method === 'POST' ? offer : method === 'PATCH' ? 'a=end-of-candidates\r\n' : undefined
  const url = origin + '/api/relay/source/whep' + (resource ? '/' + resource : '')
  return source(new Request(url,{method,headers,body}),{params:Promise.resolve({resource:resource ? [resource] : []})})
}

it('removes the private relay markers from a public WHEP offer and preserves its viewer identity', async () => {
  const owner = account()
  const { getOwnedChannel } = await import('./channels')
  const { POST } = await import('@/app/media/whep/[...path]/route')
  const path = getOwnedChannel(owner.id)!.mediaPath
  const viewer = randomUUID()
  const url = new URL('/media/whep/' + path + '/whep', origin)
  url.search = 'frankerzspam_internal=relay&frankerzspam_internal=thumbnail&relay_generation=private'
  url.searchParams.set('frankerzspam_viewer', viewer)
  url.searchParams.append('codec', 'H264')
  url.searchParams.append('codec', 'Opus')
  const response = await POST(new Request(url, {
    method: 'POST', headers: { Cookie: owner.cookie, 'Content-Type': 'application/sdp' }, body: offer,
  }))
  expect(response.status).toBe(201)
  const sent = calls.at(-1)!.url
  expect(sent.pathname).toBe('/' + path + '/whep')
  expect([...sent.searchParams]).toEqual([
    ['frankerzspam_viewer', viewer], ['codec', 'H264'], ['codec', 'Opus'],
  ])
})

it('binds the source Location to a channel and pairing generation and only forwards media headers', async () => {
  const owner = account()
  const relay = await pairDownload(owner)
  const secondChannel = await pairDownload(account())
  const response = await sourceRequest('POST',relay.credential)
  expect(response.status).toBe(201)
  expect(response.headers.has('set-cookie')).toBe(false)
  const resource = response.headers.get('location')!.split('/').at(-1)!
  expect(resource.startsWith(remoteId + '.')).toBe(true)
  const upstreamPost = calls.at(-1)!
  expect(upstreamPost.url.pathname).toBe('/' + relay.mediaPath + '/whep')
  expect(upstreamPost.url.searchParams.get('frankerzspam_internal')).toBe('relay')
  expect(upstreamPost.url.searchParams.get('relay_generation')).toBeTruthy()
  expect(upstreamPost.body).toBe(offer)
  expect(upstreamPost.headers.authorization).toBeUndefined()
  expect(upstreamPost.headers.cookie).toBeUndefined()
  expect(upstreamPost.headers['x-internal-auth']).toBeUndefined()
  expect((await sourceRequest('PATCH',relay.credential,resource)).status).toBe(204)
  expect(calls.at(-1)!.url.pathname).toBe('/' + relay.mediaPath + '/whep/' + remoteId)
  expect(calls.at(-1)!.headers['if-match']).toBe('*')
  const before = calls.length
  expect((await sourceRequest('DELETE',secondChannel.credential,resource)).status).toBe(404)
  const repaired = await pairDownload(owner)
  expect((await sourceRequest('DELETE',relay.credential,resource)).status).toBe(401)
  expect((await sourceRequest('DELETE',repaired.credential,resource)).status).toBe(404)
  expect(calls.length).toBe(before)
})

it.each(['revoke', 'rotate'])('closes a source when %s wins the race to open it', async (action) => {
  const owner = account()
  const relay = await pairDownload(owner)
  const {issueRelayPairingTicket, revokeRelayCredential, redeemRelayPairingTicket} = await import('./relay-credentials')
  const ticket = issueRelayPairingTicket(owner.id)
  afterSourceOffer = () => {
    if (action === 'rotate') redeemRelayPairingTicket(ticket)
    else revokeRelayCredential(owner.id)
  }
  try {
    const response = await sourceRequest('POST',relay.credential)
    expect(response.status).toBe(401)
    expect(response.headers.get('location')).toBeNull()
    expect(calls.slice(-2).map(c => c.method)).toEqual(['POST','DELETE'])
    expect(calls.at(-1)!.url.pathname).toBe('/' + relay.mediaPath + '/whep/' + remoteId)
  } finally {
    afterSourceOffer = undefined
  }
})
