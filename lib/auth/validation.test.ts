import { describe, expect, it } from 'vitest'

import { safeReturnTo } from '@/lib/auth/validation'

describe('safeReturnTo', () => {
  it('accepts same-origin paths', () => {
    expect(safeReturnTo('/watch/live?mode=hls')).toBe('/watch/live?mode=hls')
  })

  it.each([
    undefined,
    null,
    '',
    'https://example.com',
    '//example.com/path',
    'javascript:alert(1)',
  ])('rejects an unsafe return target: %s', (value) => {
    expect(safeReturnTo(value)).toBe('/')
  })
})

