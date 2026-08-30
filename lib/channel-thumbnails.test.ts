// @vitest-environment node

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const testDirectory = mkdtempSync(join(tmpdir(), 'channel-thumbnails-test-'))

afterAll(() => rmSync(testDirectory, { force: true, recursive: true }))

describe('channel thumbnails', () => {
  it('maps nested media paths to a single safe filename', async () => {
    const { channelThumbnailPath, thumbnailFileName } = await import(
      '@/lib/channel-thumbnails'
    )

    expect(thumbnailFileName('channels/my-friend')).toBe(
      'channels%2Fmy-friend.jpg',
    )
    expect(channelThumbnailPath('channels/my-friend', testDirectory)).toBe(
      join(testDirectory, 'channels%2Fmy-friend.jpg'),
    )
  })

  it('returns a versioned URL only after a thumbnail exists', async () => {
    const { channelThumbnailPath, channelThumbnailUrl } = await import(
      '@/lib/channel-thumbnails'
    )
    const channel = {
      slug: 'my-friend',
      mediaPath: 'channels/my-friend',
    }

    expect(channelThumbnailUrl(channel, testDirectory)).toBeUndefined()
    mkdirSync(testDirectory, { recursive: true })
    writeFileSync(channelThumbnailPath(channel.mediaPath, testDirectory), 'jpeg')
    expect(channelThumbnailUrl(channel, testDirectory)).toMatch(
      /^\/api\/channels\/my-friend\/thumbnail\?v=\d+$/,
    )
  })

  it('keeps an explicitly configured poster', async () => {
    const { channelThumbnailUrl } = await import('@/lib/channel-thumbnails')

    expect(
      channelThumbnailUrl(
        {
          slug: 'my-friend',
          mediaPath: 'channels/my-friend',
          poster: '/configured.jpg',
        },
        testDirectory,
      ),
    ).toBe('/configured.jpg')
  })
})
