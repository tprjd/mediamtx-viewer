'use client'

import { useSyncExternalStore } from 'react'

import {
  CHAT_PREFERENCE_STORAGE_KEY,
  isChatPreference,
  type ChatPreference,
} from '@/lib/chat-preferences'

const PREFERENCE_CHANGE_EVENT = 'home-stream:chat-preference-change'
let fallbackPreference: ChatPreference | null = null

function getPreferenceSnapshot(): ChatPreference {
  if (typeof window === 'undefined') return 'open'

  try {
    const stored = window.localStorage.getItem(CHAT_PREFERENCE_STORAGE_KEY)
    if (isChatPreference(stored)) return stored
    return fallbackPreference ?? 'open'
  } catch {
    return fallbackPreference ?? 'open'
  }
}

function subscribeToPreference(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}

  const handleStorage = (event: StorageEvent) => {
    if (
      event.key === null ||
      event.key === CHAT_PREFERENCE_STORAGE_KEY
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

export function setChatPreference(preference: ChatPreference): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(CHAT_PREFERENCE_STORAGE_KEY, preference)
    fallbackPreference = null
  } catch {
    fallbackPreference = preference
  }

  window.dispatchEvent(new Event(PREFERENCE_CHANGE_EVENT))
}

export function useChatPreference(): {
  preference: ChatPreference
  setPreference: (preference: ChatPreference) => void
} {
  const preference = useSyncExternalStore(
    subscribeToPreference,
    getPreferenceSnapshot,
    (): ChatPreference => 'open',
  )

  return {
    preference,
    setPreference: setChatPreference,
  }
}
