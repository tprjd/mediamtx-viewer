// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { checkChatAlerts } from './chat-alerts.mjs'

it('waits five minutes, deduplicates each active fault, and sends one recovery', async () => {
  const state = {}
  const send = vi.fn(async () => {})
  const save = vi.fn(async () => {})
  const check = (now, faults = ['centrifugo']) =>
    checkChatAlerts({ state, faults, now, send, save })
  await check(0)
  await check(299_999)
  expect(send).not.toHaveBeenCalled()
  await check(300_000)
  expect(send.mock.calls).toEqual([
    ['Chat fault active for five minutes: centrifugo.'],
  ])
  await check(600_000)
  // Reload persisted state to represent a notifier restart.
  await checkChatAlerts({
    state: JSON.parse(JSON.stringify(state)),
    faults: ['centrifugo'],
    now: 700_000,
    send,
    save,
  })
  expect(send).toHaveBeenCalledTimes(1)
  await check(710_000, [])
  await check(720_000, [])
  expect(send.mock.calls).toEqual([
    ['Chat fault active for five minutes: centrifugo.'],
    ['Chat fault cleared: centrifugo.'],
  ])
  await check(800_000, ['database'])
  await check(810_000, [])
  expect(send).toHaveBeenCalledTimes(2)
  await check(900_000, ['disk-limit', 'outbox', 'secret participant content'])
  await check(1_200_000, ['disk-limit', 'outbox', 'secret participant content'])
  expect(send).toHaveBeenCalledTimes(4)
  expect(JSON.stringify(send.mock.calls)).not.toContain(
    'secret participant content',
  )
})

it('retries a failed Discord request without claiming delivery or logging its error', async () => {
  const state = {}
  const send = vi
    .fn()
    .mockRejectedValueOnce(new Error('private note token cookie'))
    .mockResolvedValue(undefined)
  const save = vi.fn(async () => {})
  await checkChatAlerts({ state, faults: ['database'], now: 0, send, save })
  await expect(
    checkChatAlerts({ state, faults: ['database'], now: 300_000, send, save }),
  ).rejects.toThrow()
  await checkChatAlerts({
    state,
    faults: ['database'],
    now: 310_000,
    send,
    save,
  })
  await checkChatAlerts({
    state,
    faults: ['database'],
    now: 320_000,
    send,
    save,
  })
  expect(send).toHaveBeenCalledTimes(2)
})

it('keeps an alerted fault active when a failed database check cannot confirm recovery', async () => {
  const state = {
    outbox: { since: 0, notified: true },
    'database-limit': { since: 0, notified: true },
  }
  const send = vi.fn(async () => {})
  const save = vi.fn(async () => {})
  await checkChatAlerts({
    state,
    faults: ['database'],
    uncheckedFaults: ['outbox', 'database-limit'],
    now: 600_000,
    send,
    save,
  })
  expect(send).not.toHaveBeenCalled()
  await checkChatAlerts({
    state,
    faults: ['outbox', 'database-limit'],
    now: 610_000,
    send,
    save,
  })
  expect(send).not.toHaveBeenCalled()
  await checkChatAlerts({ state, faults: [], now: 620_000, send, save })
  expect(send.mock.calls).toEqual([
    ['Chat fault cleared: outbox.'],
    ['Chat fault cleared: database-limit.'],
  ])
})
