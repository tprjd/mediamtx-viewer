import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { StatusBadge } from '@/components/status-badge'

describe('StatusBadge', () => {
  it.each([
    ['live', 'Live'],
    ['offline', 'Offline'],
    ['unavailable', 'Status unavailable'],
  ] as const)('renders the %s state', (state, label) => {
    render(<StatusBadge state={state} />)

    expect(screen.getByText(label)).toBeInTheDocument()
  })
})
