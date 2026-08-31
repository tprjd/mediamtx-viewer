import { describe, expect, it } from 'vitest'

import {
  activePathsFromPayload,
  encodedMediaPath,
  ffmpegArguments,
  isSupportedMediaPath,
  thumbnailFileName,
} from './thumbnail-worker.mjs'

describe('thumbnail worker', () => {
  it('accepts only application-owned MediaMTX paths', () => {
    expect(isSupportedMediaPath('live')).toBe(true)
    expect(isSupportedMediaPath('channels/my-friend')).toBe(true)
    expect(isSupportedMediaPath('channels/not/normalized')).toBe(false)
    expect(isSupportedMediaPath('../private')).toBe(false)
  })

  it('extracts ready paths from the Control API response', () => {
    expect(
      activePathsFromPayload({
        items: [
          { name: 'live', ready: true },
          { name: 'channels/offline', ready: false },
          { name: 'unmanaged', ready: true },
        ],
      }),
    ).toEqual(['live'])
  })

  it('uses the same safe filename and encoded path as the application', () => {
    expect(thumbnailFileName('channels/my-friend')).toBe(
      'channels%2Fmy-friend.jpg',
    )
    expect(encodedMediaPath('channels/my-friend')).toBe('channels/my-friend')
  })

  it('builds a bounded single-frame FFmpeg command', () => {
    const arguments_ = ffmpegArguments(
      'channels/my-friend',
      '/thumbnails/.temporary.jpg',
      'http://mediamtx:8888/',
    )

    expect(arguments_).toContain(
      'http://mediamtx:8888/channels/my-friend/index.m3u8?frankerzspam_internal=thumbnail',
    )
    expect(arguments_).toContain('1.0')
    expect(arguments_).toContain('FrankerzSpamThumbnailer/1.0')
    expect(arguments_).toContain('1')
    expect(arguments_.at(-1)).toBe('/thumbnails/.temporary.jpg')
  })
})
