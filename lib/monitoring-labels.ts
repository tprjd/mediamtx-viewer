// Only build-time route templates can leave the application.
export const monitoringRoutes = [
  '/',
  '/account',
  '/account/channel',
  '/account/channel/obs-setup.cmd',
  '/account/channel/obs-setup/[code]',
  '/admin/chat',
  '/admin/users',
  '/api/admin/chat/moderation',
  '/api/auth/[...all]',
  '/api/channel-events',
  '/api/channels',
  '/api/channels/[slug]/chat/history',
  '/api/channels/[slug]/chat/messages',
  '/api/channels/[slug]/chat/messages/[messageId]/ban',
  '/api/channels/[slug]/chat/messages/[messageId]/removal',
  '/api/channels/[slug]/chat/messages/[messageId]/timeout',
  '/api/channels/[slug]/chat/restrictions',
  '/api/channels/[slug]/chat/state',
  '/api/channels/[slug]/chat/token',
  '/api/channels/[slug]/status',
  '/api/channels/[slug]/thumbnail',
  '/api/channels/[slug]/viewing-access',
  '/api/chat/config',
  '/api/health',
  '/api/internal/authorize',
  '/api/internal/channel-events',
  '/api/internal/chat/connect',
  '/api/internal/chat/refresh',
  '/api/internal/chat/restore',
  '/api/internal/hls-worker',
  '/api/internal/mediamtx/authorize',
  '/api/notifications',
  '/api/obs-setup/device/poll',
  '/api/obs-setup/device/start',
  '/forgot-password',
  '/login',
  '/media/hls/[...path]',
  '/media/whep/[...path]',
  '/register',
  '/registration-pending',
  '/reset-password',
  '/statistics',
  '/verify-email',
  '/watch/[slug]',
] as const
export function monitoringRoute(value: unknown): string {
  const route = typeof value === 'string' ? value.replace(/\/(?:page|route)$/, '') || '/' : ''
  return monitoringRoutes.some(template => template === route) ? route : '/unmatched'
}
export function monitoringMethod(value: unknown): string {
  return typeof value === 'string' && ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(value) ? value : 'OTHER'
}
export const databaseOperations = ['account_access', 'channel_watch_access', 'channel_list', 'channel_read'] as const
