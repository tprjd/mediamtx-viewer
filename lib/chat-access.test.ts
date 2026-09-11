// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ active: true }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/session', () => ({
  getActiveSession: vi.fn(async () => ({ user: { id: 'participant-id' } })),
}))
vi.mock('@/lib/auth/store', () => ({
  getUserById: vi.fn(() => ({
    id: 'participant-id',
    name: 'Participant',
    activationStatus: state.active ? 'active' : 'disabled',
  })),
}))
vi.mock('@/lib/channels', () => ({
  getChatChannel: vi.fn(() => ({
    id: 'channel-id',
    ownerUserId: 'owner-id',
    mediaPath: 'live',
  })),
}))
vi.mock('@/lib/chat-environment', () => ({
  getChatRuntimeConfigurationErrors: vi.fn(() => []),
  isChatEnabled: vi.fn(() => true),
}))
vi.mock('@/lib/mediamtx', () => ({
  getChannelStatus: vi.fn(async () => {
    state.active = false
    return { live: true }
  }),
}))

import { authorizeLiveChat } from '@/lib/chat-access'

beforeEach(() => {
  state.active = true
})

describe('live Chat access', () => {
  it('rejects an account disabled during the live-status check', async () => {
    await expect(authorizeLiveChat('live')).resolves.toEqual({
      ok: false,
      status: 401,
      error: 'An active account is required.',
    })
  })
})
