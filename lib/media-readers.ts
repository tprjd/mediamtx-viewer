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

export function countViewers(
  readers: readonly { id: string; type: string }[],
  thumbnailReaderIds: ReadonlySet<string> | null,
  readerViewerIds: ReadonlyMap<string, string>,
): number {
  return new Set(
    readers
      .filter(reader => ['hlsSession', 'webRTCSession'].includes(reader.type) && !thumbnailReaderIds?.has(reader.id))
      .map(reader => readerViewerIds.has(reader.id) ? `viewer:${readerViewerIds.get(reader.id)}` : `reader:${reader.id}`),
  ).size
}
