'use client'

import { ArrowLeft, ArrowRight } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, type ReactNode } from 'react'

import styles from './chat-design-prototype.module.css'

export const chatPrototypeVariants = [
  { key: 'A', name: 'Compact feed', description: 'Selected design · Chat settings + moderation' },
  { key: 'B', name: 'Time groups', description: 'Minute sections · room summary · full-width input' },
  { key: 'C', name: 'Tools rail', description: 'Side controls · open transcript · bottom room bar' },
]

// Throwaway shared switcher. URL state is the source of truth.
export function PrototypeSwitcher({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const index = Math.max(0, chatPrototypeVariants.findIndex(({ key }) => key === searchParams.get('variant')))
  const current = chatPrototypeVariants[index]
  const cycle = useCallback((direction: number) => {
    const query = new URLSearchParams(searchParams.toString())
    query.set('variant', chatPrototypeVariants[(index + direction + 3) % 3].key)
    router.replace(`${pathname}?${query}`, { scroll: false })
  }, [index, pathname, router, searchParams])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
      const target = event.target
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable], [role="menu"], [role="dialog"]')) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      cycle(event.key === 'ArrowRight' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cycle])

  if (process.env.NODE_ENV === 'production') return null

  return (
    <aside className={styles.switcher} aria-label="Chat design prototype controls">
      <div className={styles.variantPicker}>
        <span className={styles.prototypeLabel}>PROTOTYPE</span>
        <button onClick={() => cycle(-1)} aria-label="Previous variant"><ArrowLeft size={17} /></button>
        <div aria-live="polite"><strong>{current.key} / {current.name}</strong><small>{current.description}</small></div>
        <button onClick={() => cycle(1)} aria-label="Next variant"><ArrowRight size={17} /></button>
      </div>
      <div className={styles.previewControls}>{children}</div>
    </aside>
  )
}
