'use client'

import { Check, Share2 } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'

interface ShareButtonProps {
  title: string
}

export function ShareButton({ title }: ShareButtonProps) {
  const [copied, setCopied] = useState(false)

  const share = async () => {
    const data = { title, url: window.location.href }

    try {
      if (navigator.share) {
        await navigator.share(data)
      } else {
        await navigator.clipboard.writeText(data.url)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1800)
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
  }

  return (
    <Tooltip content={copied ? 'Link copied' : 'Share this stream'}>
      <Button
        aria-label={copied ? 'Link copied' : 'Share this stream'}
        onClick={share}
        size="icon"
        variant="secondary"
      >
        {copied ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Share2 className="size-4" aria-hidden="true" />
        )}
      </Button>
    </Tooltip>
  )
}
