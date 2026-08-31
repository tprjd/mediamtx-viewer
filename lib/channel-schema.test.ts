import { describe, expect, it } from 'vitest'

import { channelsSchema } from '@/lib/channel-schema'

const validChannel = {
  slug: 'main-stream',
  mediaPath: 'live/main',
  ownerName: 'David',
  title: 'Playing games',
  accentColor: '#8b5cf6',
  preferredPlayback: 'hls' as const,
}

describe('channelsSchema', () => {
  it('accepts a normalized channel', () => {
    const result = channelsSchema.parse([validChannel])

    expect(result[0]).toMatchObject(validChannel)
  })

  it('rejects duplicate public slugs', () => {
    expect(() =>
      channelsSchema.parse([
        validChannel,
        { ...validChannel, mediaPath: 'friend/live' },
      ]),
    ).toThrow(/Duplicate channel slug/)
  })

  it('rejects path traversal', () => {
    expect(() =>
      channelsSchema.parse([{ ...validChannel, mediaPath: '../private' }]),
    ).toThrow(/normalized relative paths/)
  })
})
