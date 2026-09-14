import { expect, test, type Locator } from '@playwright/test'
import Database from 'better-sqlite3'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

const centrifugoContainer = 'mediamtx-viewer-e2e-centrifugo'
const chatDatabasePath = resolve('.data/e2e-chat.sqlite')
const authDatabasePath = resolve('.data/e2e-chat-auth.sqlite')

test.describe.configure({ mode: 'serial' })

function runDocker(...args: string[]): void {
  const result = spawnSync('docker', args, { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
}

async function waitForCentrifugo(): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return (await fetch('http://127.0.0.1:3800/health')).ok
        } catch {
          return false
        }
      },
      { timeout: 10_000 },
    )
    .toBe(true)
}

async function scrollChatToTop(log: Locator): Promise<void> {
  await log.evaluate((element) => {
    if (element.scrollTop === 0 && element.scrollHeight > element.clientHeight) {
      element.scrollTop = 1
      element.dispatchEvent(new Event('scroll'))
    }
    element.scrollTop = 0
    element.dispatchEvent(new Event('scroll'))
  })
}

function seedRetainedChatHistory(
  prefix: string,
  includeDateBoundary = false,
): void {
  const authDatabase = new Database(authDatabasePath, { readonly: true })
  const channel = authDatabase
    .prepare(
      `SELECT channel.id, channel.owner_user_id AS ownerId, user.name AS ownerName
       FROM channel
       JOIN user ON user.id = channel.owner_user_id
       WHERE channel.slug = 'live'`,
    )
    .get() as { id: string; ownerId: string; ownerName: string }
  authDatabase.close()

  const chatDatabase = new Database(chatDatabasePath)
  chatDatabase.pragma('foreign_keys = ON')
  const roomId = randomUUID()
  const now = Date.now()
  const localMidnight = new Date(now)
  localMidnight.setHours(0, 0, 0, 0)
  const previousLocalDay = localMidnight.getTime() - 1_000
  chatDatabase.transaction(() => {
    chatDatabase
      .prepare('DELETE FROM chat_room WHERE channel_id = ?')
      .run(channel.id)
    chatDatabase
      .prepare(
        `INSERT INTO chat_room (id, channel_id, next_sequence, created_at)
         VALUES (?, ?, 207, ?)`,
      )
      .run(roomId, channel.id, now)
    chatDatabase
      .prepare(
        `INSERT INTO chat_participant
          (room_id, account_id, author_tag, created_at)
         VALUES (?, ?, 'seed', ?)`,
      )
      .run(roomId, channel.ownerId, now)
    const insertMessage = chatDatabase.prepare(
      `INSERT INTO chat_message (
        id, room_id, room_sequence, account_id, profile_name,
        author_tag, content, created_at
      ) VALUES (?, ?, ?, ?, ?, 'seed', ?, ?)`,
    )
    insertMessage.run(
      `${prefix}-expired`,
      roomId,
      1,
      channel.ownerId,
      channel.ownerName,
      `${prefix} expired`,
      now - 8 * 24 * 60 * 60 * 1000,
    )
    for (let retainedNumber = 1; retainedNumber <= 205; retainedNumber += 1) {
      insertMessage.run(
        `${prefix}-${retainedNumber}`,
        roomId,
        retainedNumber + 1,
        channel.ownerId,
        channel.ownerName,
        `${prefix} retained ${retainedNumber}`,
        includeDateBoundary && retainedNumber === 1
          ? previousLocalDay
          : now,
      )
    }
  })()
  chatDatabase.close()
}

async function signInAsAdministrator(page: import('@playwright/test').Page) {
  await page.goto('/login?returnTo=/watch/live')
  await page.getByLabel('Username').fill('power')
  await page.getByLabel('Password').fill('e2e-administrator-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL('/watch/live', { timeout: 15_000 })
}

test('lets an active participant send and reload one Chat message', async ({
  page,
}) => {
  await signInAsAdministrator(page)

  const chat = page.getByRole('complementary', { name: 'Chat' })
  const content = `durable Chat message ${randomUUID()}`
  await chat.getByRole('textbox', { name: 'Chat message' }).fill(content)
  await chat.getByRole('button', { name: 'Send' }).click()

  const acceptedMessage = chat.getByRole('listitem').filter({ hasText: content })
  await expect(acceptedMessage.getByText(content, { exact: true })).toBeVisible()
  await expect(acceptedMessage.getByText('power', { exact: true })).toBeVisible()
  await expect(acceptedMessage.getByText('Admin', { exact: true })).toBeVisible()

  await page.reload()

  await expect(
    page
      .getByRole('complementary', { name: 'Chat' })
      .getByText(content, { exact: true }),
  ).toBeVisible()
})

test('browses retained Chat history without losing the reading position', async ({
  page,
}) => {
  test.setTimeout(60_000)
  runDocker('start', centrifugoContainer)
  await waitForCentrifugo()
  const prefix = `retained-${randomUUID()}`
  seedRetainedChatHistory(prefix, true)
  await page.setViewportSize({ width: 1440, height: 900 })
  await signInAsAdministrator(page)

  const chat = page.getByRole('complementary', { name: 'Chat' })
  const log = chat.getByRole('log', { name: 'Chat messages' })
  await expect(log).toHaveAttribute('data-realtime-state', 'connected')
  await expect(
    chat.getByText(`${prefix} retained 205`, { exact: true }),
  ).toBeVisible()
  await expect.poll(() => log.getAttribute('data-at-bottom')).toBe('true')
  await expect
    .poll(() =>
      log.evaluate(
        (element) =>
          element.scrollTop + element.clientHeight >= element.scrollHeight - 2,
      ),
    )
    .toBe(true)
  expect(await chat.getByRole('listitem').count()).toBeLessThan(30)
  await page.evaluate(
    () =>
      new Promise<void>((resolveFrame) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))
      }),
  )

  let releaseFirstPage: () => void = () => undefined
  let markFirstPageRequested: () => void = () => undefined
  const firstPageRequested = new Promise<void>((resolveRequest) => {
    markFirstPageRequested = resolveRequest
  })
  const firstPageRelease = new Promise<void>((resolveRelease) => {
    releaseFirstPage = resolveRelease
  })
  let delayedFirstPage = true
  await page.route('**/chat/messages?before=*', async (route) => {
    if (delayedFirstPage) {
      delayedFirstPage = false
      markFirstPageRequested()
      await firstPageRelease
    }
    await route.continue()
  })

  await scrollChatToTop(log)
  await firstPageRequested
  const anchor = chat.locator(`[data-message-id="${prefix}-106"]`)
  await expect(anchor).toBeVisible()
  const anchorTopBefore = (await anchor.boundingBox())!.y
  const firstPageResponse = page.waitForResponse((response) =>
    response.url().includes('/chat/messages?before='),
  )
  releaseFirstPage()
  await firstPageResponse
  await expect(chat.locator('[data-index="100"]')).toBeVisible()
  const anchorTopAfter = (await anchor.boundingBox())!.y
  expect(Math.abs(anchorTopAfter - anchorTopBefore)).toBeLessThan(12)
  expect(await chat.getByRole('listitem').count()).toBeLessThan(30)

  const finalPageResponse = page.waitForResponse((response) =>
    response.url().includes('/chat/messages?before='),
  )
  await scrollChatToTop(log)
  await finalPageResponse
  await scrollChatToTop(log)
  await expect(
    chat.getByText('This is the start of the last seven days.'),
  ).toBeVisible()
  await expect(chat.getByText(`${prefix} retained 1`, { exact: true })).toBeVisible()
  await expect(chat.getByText(`${prefix} expired`, { exact: true })).toHaveCount(0)

  const oldestMessage = chat.locator(`[data-message-id="${prefix}-1"]`)
  const oldestTopBefore = (await oldestMessage.boundingBox())!.y
  const scrollPositionBefore = await log.evaluate((element) => element.scrollTop)
  const scrollHeightBefore = await log.evaluate((element) => element.scrollHeight)
  const incomingContent = `${prefix} incoming`
  const sendResponse = await page.request.post(
    '/api/channels/live/chat/messages',
    { data: { content: incomingContent } },
  )
  expect(sendResponse.ok()).toBe(true)
  await expect
    .poll(() => log.evaluate((element) => element.scrollHeight))
    .toBeGreaterThan(scrollHeightBefore)
  expect(await log.evaluate((element) => element.scrollTop)).toBe(
    scrollPositionBefore,
  )
  expect((await oldestMessage.boundingBox())!.y).toBe(oldestTopBefore)
  await expect(chat.getByRole('button', { name: 'New messages' })).toBeVisible()
  await expect(chat.getByRole('status')).toBeEmpty()
  await expect(chat.getByRole('status')).toHaveAttribute('aria-live', 'off')
  await expect(chat.getByRole('separator')).toHaveCount(2)

  await chat.getByRole('button', { name: 'New messages' }).click()
  await expect(chat.getByText(incomingContent, { exact: true })).toBeVisible()
  await expect.poll(() => log.getAttribute('data-at-bottom')).toBe('true')

  const announcedContent = `${prefix} announced at the live end`
  const announcedResponse = await page.request.post(
    '/api/channels/live/chat/messages',
    { data: { content: announcedContent } },
  )
  expect(announcedResponse.ok()).toBe(true)
  await expect(chat.getByText(announcedContent, { exact: true })).toBeVisible()
  await expect(chat.getByRole('status')).toContainText(announcedContent)
  await expect(chat.getByRole('status')).toHaveAttribute('aria-live', 'polite')

  await chat.getByRole('button', { name: 'Close Chat' }).click()
  await page.getByRole('button', { name: 'Open Chat' }).click()
  const reopenedChat = page.getByRole('complementary', { name: 'Chat' })
  const reopenedLog = reopenedChat.getByRole('log', { name: 'Chat messages' })
  await expect(reopenedChat.getByText(incomingContent, { exact: true })).toBeVisible()
  await expect(reopenedLog).toHaveAttribute('data-at-bottom', 'true')
  await expect(reopenedChat.getByRole('button', { name: 'New messages' })).toHaveCount(0)
  await expect(reopenedChat.getByRole('status')).toBeEmpty()

  await page.setViewportSize({ width: 760, height: 900 })
  const narrowToggle = reopenedChat.getByRole('button', {
    name: 'Chat',
    exact: true,
  })
  await expect(narrowToggle).toHaveAttribute('aria-expanded', 'false')
  await narrowToggle.click()
  await expect(reopenedLog).toBeVisible()

  await narrowToggle.click()
  await expect(reopenedLog).toBeHidden()
  const hiddenContent = `${prefix} arrived while Chat was hidden`
  const hiddenResponse = await page.request.post(
    '/api/channels/live/chat/messages',
    { data: { content: hiddenContent } },
  )
  expect(hiddenResponse.ok()).toBe(true)
  await narrowToggle.click()
  await expect(reopenedLog).toBeVisible()
  await expect(
    reopenedChat.getByText(hiddenContent, { exact: true }),
  ).toBeVisible()
  await expect(reopenedChat.getByRole('status')).toBeEmpty()
  const narrowLiveContent = `${prefix} arrived at narrow live end`
  const narrowLiveResponse = await page.request.post(
    '/api/channels/live/chat/messages',
    { data: { content: narrowLiveContent } },
  )
  expect(narrowLiveResponse.ok()).toBe(true)
  await expect(
    reopenedChat.getByText(narrowLiveContent, { exact: true }),
  ).toBeVisible()
  await expect.poll(() => reopenedLog.getAttribute('data-at-bottom')).toBe('true')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: 'Enter theater mode' }).click()
  await expect(reopenedLog).toBeVisible()
  await expect(page.getByRole('main')).toHaveAttribute('data-theater-mode', 'true')
  const theaterLiveContent = `${prefix} arrived in theater mode`
  const theaterLiveResponse = await page.request.post(
    '/api/channels/live/chat/messages',
    { data: { content: theaterLiveContent } },
  )
  expect(theaterLiveResponse.ok()).toBe(true)
  await expect(
    reopenedChat.getByText(theaterLiveContent, { exact: true }),
  ).toBeVisible()
  await expect.poll(() => reopenedLog.getAttribute('data-at-bottom')).toBe('true')
})

test('delivers one accepted Chat message to another active participant', async ({
  browser,
}) => {
  runDocker('start', centrifugoContainer)
  await waitForCentrifugo()
  const senderContext = await browser.newContext()
  const receiverContext = await browser.newContext()
  const sender = await senderContext.newPage()
  const receiver = await receiverContext.newPage()
  try {
    await sender.goto('/login?returnTo=/watch/live')
    await sender.getByLabel('Username').fill('power')
    await sender.getByLabel('Password').fill('e2e-administrator-password')
    await sender.getByRole('button', { name: 'Sign in' }).click()
    await expect(sender).toHaveURL('/watch/live')

    await receiver.goto('/login?returnTo=/watch/live')
    await receiver.getByLabel('Username').fill('chat_friend')
    await receiver.getByLabel('Password').fill('e2e-participant-password')
    await receiver.getByRole('button', { name: 'Sign in' }).click()
    await expect(receiver).toHaveURL('/watch/live')

    const senderChat = sender.getByRole('complementary', { name: 'Chat' })
    const receiverChat = receiver.getByRole('complementary', { name: 'Chat' })
    await expect(senderChat.getByRole('log')).toHaveAttribute(
      'data-realtime-state',
      'connected',
    )
    await expect(receiverChat.getByRole('log')).toHaveAttribute(
      'data-realtime-state',
      'connected',
    )

    const content = `live Chat message ${randomUUID()}`
    await senderChat.getByRole('textbox', { name: 'Chat message' }).fill(content)
    await senderChat.getByRole('button', { name: 'Send' }).click()

    await expect(receiverChat.getByText(content, { exact: true })).toBeVisible()

    let reconciliationRequests = 0
    receiver.on('request', (request) => {
      if (request.url().includes('/chat/messages?after=')) {
        reconciliationRequests += 1
      }
    })
    await receiver.evaluate(() => {
      window.name = 'watch-page-not-reloaded'
    })
    const video = await receiver.locator('video').elementHandle()
    expect(video).not.toBeNull()

    runDocker('stop', '--time', '1', centrifugoContainer)
    await expect
      .poll(() => receiverChat.getByRole('log').getAttribute('data-realtime-state'))
      .not.toBe('connected')

    const reconciledContent = `reconciled Chat message ${randomUUID()}`
    await senderChat
      .getByRole('textbox', { name: 'Chat message' })
      .fill(reconciledContent)
    await senderChat.getByRole('button', { name: 'Send' }).click()

    runDocker('start', centrifugoContainer)
    await waitForCentrifugo()
    await expect(
      receiverChat.getByText(reconciledContent, { exact: true }),
    ).toBeVisible({ timeout: 5_000 })
    await expect.poll(() => reconciliationRequests).toBeGreaterThan(0)
    await expect(receiverChat.getByRole('log')).toHaveAttribute(
      'data-realtime-state',
      'connected',
    )
    expect(await receiver.evaluate(() => window.name)).toBe(
      'watch-page-not-reloaded',
    )
    expect(await video?.evaluate((element) => element.isConnected)).toBe(true)
  } finally {
    await senderContext.close()
    await receiverContext.close()
  }
})
