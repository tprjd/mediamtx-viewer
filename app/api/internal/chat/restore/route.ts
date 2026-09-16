import { timingSafeEqual } from 'node:crypto'
import { authEnvironment } from '@/lib/auth/env'
import { restoreChat } from '@/lib/chat-restore'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  const actual = Buffer.from(request.headers.get('x-internal-auth') ?? '')
  const expected = Buffer.from(authEnvironment.internalSecret)
  const headers = { 'Cache-Control': 'no-store' }
  if (
    !expected.length ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  ) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers })
  }
  try {
    await restoreChat()
    return Response.json({ ok: true }, { headers })
  } catch {
    console.error(
      JSON.stringify({
        event: 'chat-restore',
        result: 'failed',
        code: 'RESTORE_FAILED',
      }),
    )
    return Response.json(
      {
        error:
          'Chat restore failed. Chat remains unavailable until a successful restore.',
      },
      { status: 503, headers },
    )
  }
}
