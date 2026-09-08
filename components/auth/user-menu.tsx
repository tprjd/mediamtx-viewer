'use client'

import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChartNoAxesCombined, LogOut, RadioTower, Settings, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import styles from './user-menu.module.css'

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

  const initials = user.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  return (
    <nav className={styles.userMenu} aria-label="Account">
      {hasOwnedChannel && (
        <Link className={styles.channelLink} href="/account/channel">
          <RadioTower className="size-4" aria-hidden="true" />
          My channel
        </Link>
      )}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            aria-label={`Open account menu for ${user.name}`}
            className={styles.accountTrigger}
            type="button"
          >
            {initials}
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            className={styles.menuContent}
            sideOffset={6}
          >
            <DropdownMenu.Label className={styles.menuLabel}>
              {user.name}
            </DropdownMenu.Label>
            <DropdownMenu.Separator className={styles.menuSeparator} />
            <DropdownMenu.Item asChild>
              <Link href="/account">
                <Settings aria-hidden="true" />
                Account
              </Link>
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild>
              <Link href="/statistics">
                <ChartNoAxesCombined aria-hidden="true" />
                Statistics
              </Link>
            </DropdownMenu.Item>
            {user.role === 'admin' && (
              <DropdownMenu.Item asChild>
                <Link href="/admin/users">
                  <ShieldCheck aria-hidden="true" />
                  Admin
                </Link>
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Separator className={styles.menuSeparator} />
            <DropdownMenu.Item asChild>
              <button onClick={signOut} type="button">
                <LogOut aria-hidden="true" />
                Sign out
              </button>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </nav>
  )
}
