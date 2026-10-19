export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.MONITORING_ENABLED === 'true') {
      try {
        const { startRequestMonitoring } = await import('@/lib/request-monitoring')
        await startRequestMonitoring({ endpoint: process.env.MONITORING_TRACES_URL, metricsHost: process.env.MONITORING_METRICS_HOST ?? '127.0.0.1' })
      } catch { console.error('Request monitoring could not start') }
    }
    const { startAccessRevocationDispatcher } = await import('@/lib/access-revocations')
    startAccessRevocationDispatcher()
    const { startChatRetention } = await import('@/lib/chat-retention')
    await startChatRetention()
    const { startChatOutboxDispatcher } = await import('@/lib/chat-outbox')
    startChatOutboxDispatcher()
    const { startChatHealthMonitor } = await import('@/lib/chat-health')
    startChatHealthMonitor()
  }
}
