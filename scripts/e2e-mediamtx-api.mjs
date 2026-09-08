import { createServer } from 'node:http'

const livePath = {
  name: 'live',
  ready: true,
  readyTime: '2026-09-09T00:00:00.000Z',
  tracks: ['H264', 'MPEG-4 Audio'],
  readers: Array.from({ length: 8 }, (_, index) => ({
    id: `browser-viewer-${index + 1}`,
    type: 'browserFixture',
  })),
}

const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json')

  if (request.url === '/v3/paths/list') {
    response.end(JSON.stringify({ items: [livePath] }))
    return
  }

  if (request.url === '/v3/paths/get/live') {
    response.end(JSON.stringify(livePath))
    return
  }

  response.statusCode = 404
  response.end(JSON.stringify({ error: 'not found' }))
})

server.listen(3997, '::1', () => {
  process.stdout.write('Browser-test MediaMTX API listening on [::1]:3997.\n')
})
