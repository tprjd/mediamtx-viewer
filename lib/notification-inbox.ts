import type { AccountNotification } from '@/lib/viewing-requests'

export function mergeNotifications(current: AccountNotification[], incoming: AccountNotification[]): AccountNotification[] {
  const items = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) items.set(item.id, item)
  return [...items.values()].sort((a, b) => b.id - a.id)
}
