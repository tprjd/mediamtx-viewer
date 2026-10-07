/** Empty configuration disables the pilot without changing Channel records. */
export function isWhipPilotChannel(slug: string): boolean {
  const pilot = process.env.WHIP_PILOT_CHANNEL?.trim()
  return Boolean(pilot) && pilot === slug
}
