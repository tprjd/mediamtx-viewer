import styles from '@/components/channel-viewer.module.css'
import type { PublicChatMessage } from '@/lib/chat-types'

function localTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

export function ChatMessage({
  message,
}: {
  message: PublicChatMessage
}) {
  return (
    <div className={styles.chatMessage} data-message-id={message.id}>
      <div className={styles.chatMessageHeader}>
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
      </div>
      <p>{message.content}</p>
    </div>
  )
}
