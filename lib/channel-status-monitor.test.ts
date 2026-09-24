import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  ChannelStatusMonitor,
  sameChannelLiveState,
  type ChannelMonitorEvent,
} from '@/lib/channel-status-monitor'
import type { ChannelLiveUpdate } from '@/lib/types'

function update(
  viewerCount: number | null,
  checkedAt: string,
  state: 'live' | 'offline' | 'unavailable' = 'live',
): ChannelLiveUpdate {
  return {
    slug: 'alice',
    ownerName: 'Alice',
    title: 'Alice stream',
    discordNotificationsEnabled: true,
    poster:
      state === 'live' ? '/api/channels/alice/thumbnail?v=123' : null,
    status: {
      state,
      live: state === 'live',
      startedAt: state === 'live' ? '2026-08-31T10:00:00.000Z' : null,
      tracks: state === 'live' ? ['AV1', 'Opus'] : [],
      viewerCount,
      checkedAt,
    },
  }
}

describe('sameChannelLiveState', () => {
  it('detects Channel metadata changes even when playback status is unchanged', () => {
    const original = update(1, '2026-08-31T10:00:00.000Z')
    expect(sameChannelLiveState(original, { ...original, title: 'Changed' })).toBe(false)
    expect(sameChannelLiveState(original, { ...original, ownerName: 'Changed' })).toBe(false)
    expect(sameChannelLiveState(original, { ...original, discordNotificationsEnabled: false })).toBe(false)
  })
  it('ignores checkedAt but detects viewer changes', () => {
    expect(
      sameChannelLiveState(
        update(1, '2026-08-31T10:00:00.000Z'),
        update(1, '2026-08-31T10:00:02.000Z'),
      ),
    ).toBe(true)
    expect(
      sameChannelLiveState(
        update(1, '2026-08-31T10:00:00.000Z'),
        update(2, '2026-08-31T10:00:02.000Z'),
      ),
    ).toBe(false)
  })
})

describe('ChannelStatusMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('publishes a directory snapshot when Channels are added or removed', async () => {
    const alice = update(1, '2026-08-31T10:00:00.000Z')
    const bob = { ...alice, slug: 'bob' }
    const loadUpdates = vi.fn().mockResolvedValueOnce([alice])
      .mockResolvedValueOnce([alice, bob]).mockResolvedValueOnce([bob])
    const monitor = new ChannelStatusMonitor({ loadUpdates })
    const events: ChannelMonitorEvent[] = []
    const stop = await monitor.subscribe((event) => events.push(event))
    await monitor.refresh()
    expect(events[1]).toMatchObject({ type: 'channel-status', data: bob })
    expect(events[2]).toMatchObject({ type: 'directory', data: { channels: [alice, bob] } })
    await monitor.refresh()
    expect(events[3]).toMatchObject({ type: 'directory', data: { channels: [bob] } })
    stop()
  })

  it('does not claim an empty directory when the first read fails', async () => {
    const alice = update(1, '2026-08-31T10:00:00.000Z')
    const loadUpdates = vi.fn().mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce([alice])
    const monitor = new ChannelStatusMonitor({ loadUpdates })
    const events: ChannelMonitorEvent[] = []
    const stop = await monitor.subscribe((event) => events.push(event))
    expect(events).toEqual([])
    await monitor.refresh()
    expect(events).toEqual([expect.objectContaining({ type: 'snapshot', data: expect.objectContaining({ channels: [alice] }) })])
    stop()
  })

  it('shares one polling loop and emits only meaningful changes', async () => {
    const results = [
      [update(1, '2026-08-31T10:00:00.000Z')],
      [update(1, '2026-08-31T10:00:02.000Z')],
      [update(2, '2026-08-31T10:00:04.000Z')],
      [update(2, '2026-08-31T10:00:06.000Z')],
    ]
    const loadUpdates = vi.fn(async () => results.shift() ?? results.at(-1) ?? [])
    const monitor = new ChannelStatusMonitor({
      loadUpdates,
      pollIntervalMs: 100,
      maximumRetryMs: 1_000,
    })
    const eventLists = Array.from({ length: 5 }, () => [] as ChannelMonitorEvent[])
    const unsubscribe = await Promise.all(
      eventLists.map((events) => monitor.subscribe((event) => events.push(event))),
    )

    expect(loadUpdates).toHaveBeenCalledOnce()
    expect(eventLists.every((events) => events[0]?.type === 'snapshot')).toBe(true)

    await vi.advanceTimersByTimeAsync(100)
    expect(loadUpdates).toHaveBeenCalledTimes(2)
    expect(eventLists.every((events) => events.length === 1)).toBe(true)

    await vi.advanceTimersByTimeAsync(100)
    expect(loadUpdates).toHaveBeenCalledTimes(3)
    expect(
      eventLists.every(
        (events) =>
          events[1]?.type === 'channel-status' &&
          events[1].data.status.viewerCount === 2,
      ),
    ).toBe(true)

    unsubscribe.forEach((stop) => stop())
    await vi.advanceTimersByTimeAsync(1_000)
    expect(loadUpdates).toHaveBeenCalledTimes(3)

    const freshEvents: ChannelMonitorEvent[] = []
    const stopFresh = await monitor.subscribe((event) => freshEvents.push(event))
    expect(loadUpdates).toHaveBeenCalledTimes(4)
    expect(freshEvents[0]).toMatchObject({
      type: 'snapshot',
      data: { channels: [{ status: { viewerCount: 2 } }] },
    })
    stopFresh()
  })

  it('retains known state for one failure before publishing unavailable', async () => {
    const results = [
      [update(1, '2026-08-31T10:00:00.000Z')],
      [update(null, '2026-08-31T10:00:02.000Z', 'unavailable')],
      [update(null, '2026-08-31T10:00:04.000Z', 'unavailable')],
    ]
    const monitor = new ChannelStatusMonitor({
      loadUpdates: vi.fn(async () => results.shift() ?? []),
      pollIntervalMs: 100,
      maximumRetryMs: 1_000,
    })
    const events: ChannelMonitorEvent[] = []
    const unsubscribe = await monitor.subscribe((event) => events.push(event))

    await vi.advanceTimersByTimeAsync(100)
    expect(events).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(200)
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({
      type: 'channel-status',
      data: { poster: null, status: { state: 'unavailable' } },
    })

    unsubscribe()
  })
})
