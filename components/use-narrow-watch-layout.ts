'use client'

import { useSyncExternalStore } from 'react'

export const NARROW_WATCH_LAYOUT_BREAKPOINT = 800

function getIsNarrowSnapshot(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.innerWidth <= NARROW_WATCH_LAYOUT_BREAKPOINT
  )
}

function subscribeToViewport(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}

  window.addEventListener('resize', listener)
  return () => window.removeEventListener('resize', listener)
}

export function useNarrowWatchLayout(): boolean {
  return useSyncExternalStore(
    subscribeToViewport,
    getIsNarrowSnapshot,
    () => false,
  )
}

function getIsPortraitChatSnapshot(): boolean {
  return getIsNarrowSnapshot() && window.innerHeight >= window.innerWidth
}

export function usePortraitChatLayout(): boolean {
  return useSyncExternalStore(
    subscribeToViewport,
    getIsPortraitChatSnapshot,
    () => false,
  )
}
