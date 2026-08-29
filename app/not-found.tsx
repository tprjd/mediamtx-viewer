import { ArrowLeft, Radio } from 'lucide-react'
import Link from 'next/link'

import { buttonVariants } from '@/components/ui/button'

export default function NotFound() {
  return (
    <main className="grid min-h-[70vh] place-items-center px-6">
      <div className="max-w-md text-center">
        <span className="player-icon mx-auto">
          <Radio className="size-6" aria-hidden="true" />
        </span>
        <p className="eyebrow mt-6">404 · No signal</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
          That channel does not exist.
        </h1>
        <p className="mt-4 leading-7 text-neutral-400">
          The link may be old, or the channel has not been made public.
        </p>
        <Link className={buttonVariants({ className: 'mt-7' })} href="/">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to channels
        </Link>
      </div>
    </main>
  )
}
