const thumbnailQueryParameter = 'frankerzspam_internal'
const thumbnailQueryValue = 'thumbnail'
const viewerQueryParameter = 'frankerzspam_viewer'
const viewerIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i

export function isThumbnailSession(
  query: string | undefined,
  userAgent: string | undefined,
): boolean {
  return (
    userAgent === 'FrankerzSpamThumbnailer/1.0' ||
    (Boolean(query) &&
      new URLSearchParams(query).get(thumbnailQueryParameter) ===
        thumbnailQueryValue)
  )
}

export function readViewerId(query: string | undefined): string | undefined {
  if (!query) return undefined
  const viewerId = new URLSearchParams(query).get(viewerQueryParameter)
  return viewerId && viewerIdPattern.test(viewerId) ? viewerId : undefined
}

export function isRelaySource(query: string | undefined): boolean {
  return Boolean(query && new URLSearchParams(query).get('frankerzspam_internal') === 'relay')
}

export function countViewers(
  readers: readonly { id: string; type: string }[],
  internalReaderIds: ReadonlySet<string> | null,
  readerViewerIds: ReadonlyMap<string, string>,
  relayViewerIds: readonly string[] = [],
): number {
  const viewers = new Set(relayViewerIds.map(id => `viewer:${id}`))
  for (const reader of readers) {
    if (!['hlsSession', 'webRTCSession'].includes(reader.type) || internalReaderIds?.has(reader.id)) continue
    const identity = readerViewerIds.get(reader.id)
    viewers.add(identity ? `viewer:${identity}` : `reader:${reader.id}`)
  }
  return viewers.size
}
