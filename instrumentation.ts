export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startChatRetention } = await import('@/lib/chat-retention')
    await startChatRetention()
    const { startChatOutboxDispatcher } = await import('@/lib/chat-outbox')
    startChatOutboxDispatcher()
    const { startChatHealthMonitor } = await import('@/lib/chat-health')
    startChatHealthMonitor()
  }
}
