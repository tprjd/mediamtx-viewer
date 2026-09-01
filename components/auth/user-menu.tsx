'use client'

import { ChartNoAxesCombined, LogOut, RadioTower, Settings, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { authClient } from '@/lib/auth/client'

interface UserMenuProps {
  hasOwnedChannel: boolean
  user: {
    name: string
    role?: string | null
  } | null
}

export function UserMenu({ hasOwnedChannel, user }: UserMenuProps) {
  const router = useRouter()
  if (!user) return null

  async function signOut() {
    await authClient.signOut()
    router.replace('/login')
    router.refresh()
  }

  return (
    <nav className="user-menu" aria-label="Account">
      {user.role === 'admin' && (
        <Link href="/admin/users">
          <ShieldCheck className="size-4" aria-hidden="true" />
          Admin
        </Link>
      )}
      <Link href="/statistics">
        <ChartNoAxesCombined className="size-4" aria-hidden="true" />
        Statistics
      </Link>
      {hasOwnedChannel && (
        <Link href="/account/channel">
          <RadioTower className="size-4" aria-hidden="true" />
          My channel
        </Link>
      )}
      <Link href="/account">
        <Settings className="size-4" aria-hidden="true" />
        {user.name}
      </Link>
      <button onClick={signOut} type="button">
        <LogOut className="size-4" aria-hidden="true" />
        Sign out
      </button>
    </nav>
  )
}
