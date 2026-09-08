export const LIVE_RAIL_PREFERENCE_STORAGE_KEY = 'home-stream.live-rail-preference'
export const LIVE_RAIL_BREAKPOINT = 1280

export type LiveRailPreference = 'expanded' | 'collapsed' | 'hidden'

export function isLiveRailPreference(
  value: unknown,
): value is LiveRailPreference {
  return value === 'expanded' || value === 'collapsed' || value === 'hidden'
}

export function readLiveRailPreference(
  storage: Pick<Storage, 'getItem'> | null | undefined,
): LiveRailPreference {
  if (!storage) return 'expanded'

  try {
    const value = storage.getItem(LIVE_RAIL_PREFERENCE_STORAGE_KEY)
    return isLiveRailPreference(value) ? value : 'expanded'
  } catch {
    return 'expanded'
  }
}

export function getEffectiveLiveRailPreference(
  preference: LiveRailPreference,
  viewportWidth: number,
): LiveRailPreference {
  if (preference === 'hidden') return 'hidden'
  return viewportWidth < LIVE_RAIL_BREAKPOINT ? 'collapsed' : preference
}
