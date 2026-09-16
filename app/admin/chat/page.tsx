import Link from 'next/link'
import { requireAdminSession } from '@/lib/auth/session'
import { ChatModerationHistory } from '@/components/admin/chat-moderation-history'

export default async function AdminChatPage() {
  await requireAdminSession()
  return (
    <main className="admin-layout">
      <section className="admin-heading">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Chat moderation records</h1>
          <p>
            Review actions across Chat rooms. Clearing records keeps active
            restrictions in effect.
          </p>
          <Link href="/admin/users">Viewer access</Link>
        </div>
      </section>
      <ChatModerationHistory />
    </main>
  )
}
