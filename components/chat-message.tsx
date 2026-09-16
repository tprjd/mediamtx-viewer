import { ChatRoleBadge } from '@/components/chat-role-badge'
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
  showTimestamps = false,
  onRemoved,
}: {
  message: PublicChatMessage
  channelSlug?: string
  moderatorRole?: ChatModeratorRole
  showTimestamps?: boolean
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

  const colors = [
    '#a5b4fc',
    '#f9a8d4',
    '#67e8f9',
    '#fde68a',
    '#86efac',
    '#fdba74',
  ]
  const color = message.removed
    ? undefined
    : colors[
        Array.from(message.authorTag).reduce(
          (sum, character) => sum + character.charCodeAt(0),
          0,
        ) % colors.length
      ]

  return (
    <div className={styles.chatMessage} data-message-id={message.id}>
      {showTimestamps && (
        <time
          className={styles.chatTimestamp}
          aria-label={`Sent ${new Date(message.serverTimestamp).toISOString()}`}
          dateTime={message.serverTimestamp}
        >
          {localTime(message.serverTimestamp)}
        </time>
      )}
      {message.removed ? (
        <span className={styles.chatRemoved}>Message removed</span>
      ) : (
        <>
          {message.badges.map((badge) => (
            <ChatRoleBadge key={badge} role={badge} />
          ))}
          <strong className={styles.chatAuthor} style={{ color }}>
            {message.profileName}
          </strong>
          <span className={styles.chatAuthorTag}> #{message.authorTag}</span>
          <span className={styles.chatColon}>: </span>
          <span className={styles.chatMessageBody}>{message.content}</span>
        </>
      )}
      {actions}
    </div>
  )
}
