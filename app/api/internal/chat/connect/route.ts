import { checkChatConnection, trustedChatProxy } from '@/lib/chat-connection-access'
export async function POST(request: Request) {
  if (!trustedChatProxy(request)) return new Response(null, { status: 404 })
  try {
    const body = await request.json()
    const result = typeof body?.data?.token === 'string' ? checkChatConnection(body.data.token) : null
    return Response.json(result ? { result } : { disconnect: { code: 3500, reason: 'Viewing access required' } })
  } catch { return Response.json({ disconnect: { code: 3500, reason: 'Invalid connection request' } }) }
}
