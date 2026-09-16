export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startChatOutboxDispatcher } = await import('@/lib/chat-outbox')
    startChatOutboxDispatcher()
    const { startChatHealthMonitor } = await import('@/lib/chat-health')
    startChatHealthMonitor()
  }
}
