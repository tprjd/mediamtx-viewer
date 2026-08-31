import { describe, expect, it } from 'vitest'

import { profileNameSchema, safeReturnTo } from '@/lib/auth/validation'

describe('profileNameSchema', () => {
  it('trims a valid profile name', () => {
    expect(profileNameSchema.parse('  David  ')).toBe('David')
  })

  it.each(['', ' ', 'D', 'x'.repeat(81)])('rejects an invalid profile name', (name) => {
    expect(profileNameSchema.safeParse(name).success).toBe(false)
  })
})

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
