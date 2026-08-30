'use client'

import { LogOut, RadioTower, Settings, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { authClient } from '@/lib/auth/client'

export function UserMenu() {
  const router = useRouter()
  const { data: session, isPending } = authClient.useSession()
  if (isPending || !session) return null

  async function signOut() {
    await authClient.signOut()
    router.replace('/login')
    router.refresh()
  }

  return (
    <nav className="user-menu" aria-label="Account">
      {session.user.role === 'admin' && (
        <Link href="/admin/users">
          <ShieldCheck className="size-4" aria-hidden="true" />
          Admin
        </Link>
      )}
      <Link href="/account/channel">
        <RadioTower className="size-4" aria-hidden="true" />
        Channel
      </Link>
      <Link href="/account">
        <Settings className="size-4" aria-hidden="true" />
        {session.user.name}
      </Link>
      <button onClick={signOut} type="button">
        <LogOut className="size-4" aria-hidden="true" />
        Sign out
      </button>
    </nav>
  )
}
