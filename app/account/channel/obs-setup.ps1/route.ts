import { getActiveSession } from '@/lib/auth/session'
import {
  OBS_SETUP_SCRIPT_FILENAME,
  getObsSetupScriptMetadata,
  readObsSetupScript,
} from '@/lib/obs-setup-script'
import { getOwnedChannel } from '@/lib/channels'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const session = await getActiveSession()
  if (!session) {
    return new Response('Authentication required.', {
      status: 401,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }
  const channel = getOwnedChannel(session.user.id)
  if (!channel?.enabled) {
    return new Response('An enabled channel is required.', {
      status: 403,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }

  const script = readObsSetupScript()
  const metadata = getObsSetupScriptMetadata()
  return new Response(script.toString('utf8'), {
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Disposition': `attachment; filename="${OBS_SETUP_SCRIPT_FILENAME}"`,
      'Content-Type': 'text/plain; charset=utf-8',
      Pragma: 'no-cache',
      'X-Checksum-SHA256': metadata.sha256,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
