import { ChatMessageActions } from '@/components/chat-message-actions'
import styles from '@/components/channel-viewer.module.css'
import type { PublicChatMessage, ChatModeratorRole } from '@/lib/chat-types'

function localTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

export function ChatMessage({
  message,
  channelSlug,
  moderatorRole = null,
  onRemoved,
}: {
  message: PublicChatMessage
  channelSlug?: string
  moderatorRole?: ChatModeratorRole
  onRemoved?: (message: PublicChatMessage) => void
}) {
  const canAct =
    moderatorRole === 'admin' ||
    (moderatorRole === 'owner' &&
      (message.removed || !message.badges.includes('admin')))
  const actions =
    canAct && channelSlug && onRemoved ? (
      <ChatMessageActions
        message={message}
        channelSlug={channelSlug}
        onRemoved={onRemoved}
      />
    ) : null

  return (
    <div className={styles.chatMessage} data-message-id={message.id}>
      <div className={styles.chatMessageHeader}>
        {message.removed ? (
          <span>Message removed</span>
        ) : (
          <>
            <strong>{message.profileName}</strong>
            <span className={styles.chatAuthorTag}>#{message.authorTag}</span>
            {message.badges.map((badge) => (
              <span className={styles.chatBadge} key={badge}>
                {badge === 'admin' ? 'Admin' : 'Owner'}
              </span>
            ))}
            <time
              aria-label={`Sent ${new Date(message.serverTimestamp).toISOString()}`}
              dateTime={message.serverTimestamp}
            >
              {localTime(message.serverTimestamp)}
            </time>
          </>
        )}
        {actions}
      </div>
      {!message.removed && <p>{message.content}</p>}
    </div>
  )
}
