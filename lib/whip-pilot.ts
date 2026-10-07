/** Empty configuration disables the pilot without changing Channel records. */
export function getWhipPilotSlug(): string {
  return process.env.WHIP_PILOT_CHANNEL?.trim() ?? ''
}

export function isWhipPilotChannel(slug: string): boolean {
  const pilot = getWhipPilotSlug()
  return Boolean(pilot) && pilot === slug
}

/** Routing and worker authorization must select the same source generation. */
export function hlsDerivativePath(path: {
  name?: string
  ready?: boolean
  source?: { type: string; id: string } | null
  tracks?: readonly string[]
}): string | undefined {
  if (!path.ready || !path.name || path.name.startsWith('_hls/') || path.source?.type !== 'webRTCSession' || !/^[a-zA-Z0-9_-]+$/.test(path.source.id)) return undefined
  if (!path.tracks?.includes('H264') || !path.tracks.includes('Opus')) return undefined
  return `_hls/${path.name}/${path.source.id}`
}
