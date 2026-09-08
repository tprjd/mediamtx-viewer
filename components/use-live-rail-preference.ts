'use client'

import { useSyncExternalStore } from 'react'

import {
  getEffectiveLiveRailPreference,
  LIVE_RAIL_BREAKPOINT,
  LIVE_RAIL_PREFERENCE_STORAGE_KEY,
  isLiveRailPreference,
  type LiveRailPreference,
} from '@/lib/live-rail-preferences'

const PREFERENCE_CHANGE_EVENT = 'home-stream:live-rail-preference-change'
let fallbackPreference: LiveRailPreference | null = null

function getPreferenceSnapshot(): LiveRailPreference {
  if (typeof window === 'undefined') return 'expanded'

  try {
    const stored = window.localStorage.getItem(LIVE_RAIL_PREFERENCE_STORAGE_KEY)
    if (isLiveRailPreference(stored)) return stored
    return fallbackPreference ?? 'expanded'
  } catch {
    return fallbackPreference ?? 'expanded'
  }
}

function subscribeToPreference(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}

  const handleStorage = (event: StorageEvent) => {
    if (
      event.key === null ||
      event.key === LIVE_RAIL_PREFERENCE_STORAGE_KEY
    ) {
      listener()
    }
  }
  const handlePreferenceChange = () => listener()

  window.addEventListener('storage', handleStorage)
  window.addEventListener(PREFERENCE_CHANGE_EVENT, handlePreferenceChange)

  return () => {
    window.removeEventListener('storage', handleStorage)
    window.removeEventListener(PREFERENCE_CHANGE_EVENT, handlePreferenceChange)
  }
}

function getViewportWidth(): number {
  return typeof window === 'undefined' ? LIVE_RAIL_BREAKPOINT : window.innerWidth
}

function subscribeToViewport(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}

  window.addEventListener('resize', listener)
  return () => window.removeEventListener('resize', listener)
}

export function setLiveRailPreference(preference: LiveRailPreference): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(LIVE_RAIL_PREFERENCE_STORAGE_KEY, preference)
    fallbackPreference = null
  } catch {
    fallbackPreference = preference
  }

  window.dispatchEvent(new Event(PREFERENCE_CHANGE_EVENT))
}

export function useLiveRailPreference(): {
  preference: LiveRailPreference
  effectivePreference: LiveRailPreference
  setPreference: (preference: LiveRailPreference) => void
} {
  const preference = useSyncExternalStore(
    subscribeToPreference,
    getPreferenceSnapshot,
    (): LiveRailPreference => 'expanded',
  )
  const viewportWidth = useSyncExternalStore(
    subscribeToViewport,
    getViewportWidth,
    () => LIVE_RAIL_BREAKPOINT,
  )

  return {
    preference,
    effectivePreference: getEffectiveLiveRailPreference(preference, viewportWidth),
    setPreference: setLiveRailPreference,
  }
}
