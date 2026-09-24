'use client'

import { useEffect } from 'react'

import { checkViewingAccess, type ViewingAccessResult } from '@/lib/auth/viewing-access-client'

const RENEWAL_INTERVAL_MS = 5 * 60_000
const RETRY_INTERVAL_MS = 30_000
const REQUEST_TIMEOUT_MS = 5_000

/** Keeps renewal on a browser response, separate from read-only server checks. */
export function SessionRenewal() {
  useEffect(() => {
    let stopped = false
    let nextCheckAt = 0
    let lastCheckAt = Number.NEGATIVE_INFINITY
    let pending: AbortController | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined

    const renew = (force = false) => {
      if (
        stopped || pending || !navigator.onLine || document.visibilityState !== 'visible' ||
        Date.now() - lastCheckAt < REQUEST_TIMEOUT_MS ||
        (!force && Date.now() < nextCheckAt)
      ) return

      lastCheckAt = Date.now()
      const controller = new AbortController()
      pending = controller
      const finish = (result: ViewingAccessResult) => {
        if (stopped || pending !== controller) return
        pending = undefined
        clearTimeout(deadline)
        controller.abort()
        // Playback owns its UI and media actions. Renewal never redirects or
        // replaces a healthy Playback run because of a transient request error.
        stopped = result === 'unauthorized'
        nextCheckAt = Date.now() + (result === 'unavailable' ? RETRY_INTERVAL_MS : RENEWAL_INTERVAL_MS)
      }
      deadline = setTimeout(() => finish('unavailable'), REQUEST_TIMEOUT_MS)
      void checkViewingAccess(controller.signal).then(finish)
    }

    const resume = () => renew(true)
    const timer = setInterval(() => renew(), RETRY_INTERVAL_MS)
    window.addEventListener('online', resume)
    window.addEventListener('focus', resume)
    window.addEventListener('pageshow', resume)
    document.addEventListener('visibilitychange', resume)
    renew()
    return () => {
      stopped = true
      clearInterval(timer)
      clearTimeout(deadline)
      pending?.abort()
      window.removeEventListener('online', resume)
      window.removeEventListener('focus', resume)
      window.removeEventListener('pageshow', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [])

  return null
}
