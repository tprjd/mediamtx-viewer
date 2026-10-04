import { refreshChatConnection, trustedChatProxy } from '@/lib/chat-connection-access'
export async function POST(request: Request) {
  if (!trustedChatProxy(request)) return new Response(null, { status: 404 })
  try { return Response.json({ result: refreshChatConnection((await request.json()).meta) }) }
  catch { return Response.json({ result: { expired: true } }) }
}
