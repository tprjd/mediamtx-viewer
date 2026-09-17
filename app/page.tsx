import { HomeDashboard } from '@/components/home-dashboard'
import { getActiveSession } from '@/lib/auth/session'
import { getPublicChannels } from '@/lib/channel-reads'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const [channels, session] = await Promise.all([
    getPublicChannels(),
    getActiveSession(),
  ])

  return (
    <HomeDashboard
      capabilities={{
        isAdmin: session?.user.role === 'admin',
      }}
      initialChannels={channels}
    />
  )
}
