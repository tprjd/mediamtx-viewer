'use client'

import { Trash2 } from 'lucide-react'
import { useFormStatus } from 'react-dom'

import { clearActivityAction } from '@/app/admin/users/actions'
import { Button } from '@/components/ui/button'

function ClearActivityButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()

  return (
    <Button disabled={disabled || pending} size="sm" type="submit" variant="secondary">
      <Trash2 aria-hidden="true" className="size-4" />
      {pending ? 'Clearing…' : 'Clear activity'}
    </Button>
  )
}

export function ClearActivityControl({ disabled }: { disabled: boolean }) {
  return (
    <form
      action={clearActivityAction}
      onSubmit={(event) => {
        if (
          !window.confirm(
            'Clear all recent activity? This permanently deletes the complete activity history.',
          )
        ) {
          event.preventDefault()
        }
      }}
    >
      <ClearActivityButton disabled={disabled} />
    </form>
  )
}
