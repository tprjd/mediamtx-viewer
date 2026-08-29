'use client'

import { AlertTriangle, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="grid min-h-[70vh] place-items-center px-6">
      <div className="max-w-md text-center">
        <span className="player-icon player-icon-warning mx-auto">
          <AlertTriangle className="size-6" aria-hidden="true" />
        </span>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-white">
          The viewer hit a problem.
        </h1>
        <p className="mt-4 leading-7 text-neutral-400">
          The stream server may still be available. Reload this view to try
          again.
        </p>
        <Button className="mt-7" onClick={reset}>
          <RotateCcw className="size-4" aria-hidden="true" />
          Try again
        </Button>
      </div>
    </main>
  )
}
