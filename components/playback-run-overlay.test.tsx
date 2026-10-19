import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { PlaybackRunOverlay } from '@/components/playback-run-overlay'

afterEach(cleanup)

const props = {
  channelSlug: 'live',
  loadingTitle: 'Joining stream',
  loadingDescription: 'Preparing playback.',
  reconnectingDescription: 'Trying to resume playback.',
}

it('keeps buffering status over the video without a full-screen recovery message', () => {
  const { container } = render(<PlaybackRunOverlay {...props} state="buffering" />)
  expect(screen.getByRole('status')).toHaveTextContent('Buffering')
  expect(container.querySelector('.player-overlay')).toBeNull()
  expect(screen.queryByText('Reconnecting')).not.toBeInTheDocument()
})

it('describes HLS media recovery without claiming that the network disconnected', () => {
  render(<PlaybackRunOverlay {...props} state="reconnecting" reconnectingTitle="Resuming playback" />)
  expect(screen.getByRole('heading')).toHaveTextContent('Resuming playback')
  expect(screen.queryByText('Reconnecting')).not.toBeInTheDocument()
})
