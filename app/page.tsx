import { HomeDashboard } from '@/components/home-dashboard'
import { requireActiveSession } from '@/lib/auth/session'
import { getPublicChannels } from '@/lib/channel-reads'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const session = await requireActiveSession()
  const channels = await getPublicChannels(session.user.id)

  return (
    <HomeDashboard
      capabilities={{
        isAdmin: session?.user.role === 'admin',
      }}
      initialChannels={channels}
    />
  )
}
