import {
  expect,
  test,
  type Locator,
  type Page,
  type BrowserContext,
} from '@playwright/test'
import Database from 'better-sqlite3'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'

const centrifugoContainer = 'mediamtx-viewer-e2e-centrifugo'
const chatDatabasePath = resolve('.data/e2e-chat.sqlite')
const authDatabasePath = resolve('.data/e2e-chat-auth.sqlite')

test.describe.configure({ mode: 'serial' })

test.beforeEach(() => {
  const database = new Database(chatDatabasePath)
  database.pragma('foreign_keys = ON')
  database.prepare('DELETE FROM chat_room').run()
  database.close()
})

async function postChat(page: Page, content: string) {
  const clientIdempotencyKey = randomUUID()
  for (;;) {
    const response = await page.request.post(
      '/api/channels/live/chat/messages',
      {
        data: { content, clientIdempotencyKey },
      },
    )
    if (response.status() !== 429) return response
    const { retryAt } = await response.json()
    await page.waitForTimeout(
      Math.max(0, Date.parse(retryAt) - Date.now()) + 20,
    )
  }
}

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
    if (
      element.scrollTop === 0 &&
      element.scrollHeight > element.clientHeight
    ) {
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
          : now - 60_000,
      )
    }
  })()
  chatDatabase.close()
}

let administratorCookies:
  Awaited<ReturnType<BrowserContext['cookies']>> | undefined

async function signInAsAdministrator(page: Page) {
  if (administratorCookies) {
    await page.context().addCookies(administratorCookies)
    await page.goto('/watch/live')
    await expect(page).toHaveURL('/watch/live')
    return
  }
  await page.goto('/login?returnTo=/watch/live')
  await page.getByLabel('Username').fill('power')
  await page.getByLabel('Password').fill('e2e-administrator-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL('/watch/live', { timeout: 15_000 })
  administratorCookies = await page.context().cookies()
}

test('lets an active participant send and reload one Chat message', async ({
  page,
}) => {
  await signInAsAdministrator(page)

  const chat = page.getByRole('complementary', { name: 'Chat' })
  const content = `durable Chat message ${randomUUID()}`
  await chat.getByRole('textbox', { name: 'Chat message' }).fill(content)
  await chat.getByRole('button', { name: 'Send' }).click()

  const acceptedMessage = chat
    .getByRole('listitem')
    .filter({ hasText: content })
  await expect(
    acceptedMessage.getByText(content, { exact: true }),
  ).toBeVisible()
  await expect(
    acceptedMessage.getByText('power', { exact: true }),
  ).toBeVisible()
  await expect(
    acceptedMessage.getByText('Admin', { exact: true }),
  ).toBeVisible()

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
  let releaseFinalPage: () => void = () => undefined
  let markFirstPageRequested: () => void = () => undefined
  let markFinalPageRequested: () => void = () => undefined
  const firstPageRequested = new Promise<void>((resolveRequest) => {
    markFirstPageRequested = resolveRequest
  })
  const finalPageRequested = new Promise<void>((resolveRequest) => {
    markFinalPageRequested = resolveRequest
  })
  const firstPageRelease = new Promise<void>((resolveRelease) => {
    releaseFirstPage = resolveRelease
  })
  const finalPageRelease = new Promise<void>((resolveRelease) => {
    releaseFinalPage = resolveRelease
  })
  let historyPageNumber = 0
  await page.route('**/chat/messages?before=*', async (route) => {
    historyPageNumber += 1
    if (historyPageNumber === 1) {
      markFirstPageRequested()
      await firstPageRelease
    } else if (historyPageNumber === 2) {
      markFinalPageRequested()
      await finalPageRelease
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
  await expect
    .poll(async () => {
      const anchorTopAfter = (await anchor.boundingBox())!.y
      return Math.abs(anchorTopAfter - anchorTopBefore)
    })
    .toBeLessThan(12)
  expect(await chat.getByRole('listitem').count()).toBeLessThan(30)

  const finalPageResponse = page.waitForResponse((response) =>
    response.url().includes('/chat/messages?before='),
  )
  await scrollChatToTop(log)
  await finalPageRequested
  const finalAnchor = chat.locator(`[data-message-entry-id="${prefix}-6"]`)
  await expect(finalAnchor).toBeVisible()
  const finalAnchorTopBefore = (await finalAnchor.boundingBox())!.y
  releaseFinalPage()
  await finalPageResponse
  await expect(finalAnchor).toBeVisible()
  await expect
    .poll(async () => {
      const finalAnchorTopAfter = (await finalAnchor.boundingBox())!.y
      return Math.abs(finalAnchorTopAfter - finalAnchorTopBefore)
    })
    .toBeLessThan(12)
  await scrollChatToTop(log)
  await expect(
    chat.getByText('This is the start of the last seven days.'),
  ).toBeVisible()
  await expect(
    chat.getByText(`${prefix} retained 1`, { exact: true }),
  ).toBeVisible()
  await expect(
    chat.getByText(`${prefix} expired`, { exact: true }),
  ).toHaveCount(0)

  const oldestMessage = chat.locator(`[data-message-id="${prefix}-1"]`)
  const oldestTopBefore = (await oldestMessage.boundingBox())!.y
  const scrollPositionBefore = await log.evaluate(
    (element) => element.scrollTop,
  )
  const scrollHeightBefore = await log.evaluate(
    (element) => element.scrollHeight,
  )
  const incomingContent = `${prefix} incoming`
  const sendResponse = await postChat(page, incomingContent)
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

  const reopenedHistoryResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().endsWith('/api/channels/live/chat/messages'),
  )
  await chat.getByRole('button', { name: 'Close Chat' }).click()
  await page.getByRole('button', { name: 'Open Chat' }).click()
  await reopenedHistoryResponse
  const reopenedChat = page.getByRole('complementary', { name: 'Chat' })
  const reopenedLog = reopenedChat.getByRole('log', { name: 'Chat messages' })
  await expect(
    reopenedChat.getByText(incomingContent, { exact: true }),
  ).toBeVisible()
  await expect(reopenedLog).toHaveAttribute('data-at-bottom', 'true')
  await expect(
    reopenedChat.getByRole('button', { name: 'New messages' }),
  ).toHaveCount(0)
  await expect(reopenedChat.getByRole('status')).toBeEmpty()

  const reopenedOlderPageResponse = page.waitForResponse((response) =>
    response.url().includes('/chat/messages?before='),
  )
  await scrollChatToTop(reopenedLog)
  await reopenedOlderPageResponse
  const readingContent = `${prefix} arrived while reading reopened history`
  const readingResponse = await postChat(page, readingContent)
  expect(readingResponse.ok()).toBe(true)
  await expect(
    reopenedChat.getByRole('button', { name: 'New messages' }),
  ).toBeVisible()
  await expect(reopenedChat.getByRole('status')).toBeEmpty()
  await expect(reopenedChat.getByRole('status')).toHaveAttribute(
    'aria-live',
    'off',
  )

  await reopenedChat.getByRole('button', { name: 'New messages' }).click()
  await expect(
    reopenedChat.getByText(readingContent, { exact: true }),
  ).toBeVisible()
  await expect
    .poll(() => reopenedLog.getAttribute('data-at-bottom'))
    .toBe('true')

  const announcedContent = `${prefix} announced at the live end`
  const announcedResponse = await postChat(page, announcedContent)
  expect(announcedResponse.ok()).toBe(true)
  await expect(
    reopenedChat.getByText(announcedContent, { exact: true }),
  ).toBeVisible()
  await expect(reopenedChat.getByRole('status')).toContainText(announcedContent)
  await expect(reopenedChat.getByRole('status')).toHaveAttribute(
    'aria-live',
    'polite',
  )

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
  const hiddenResponse = await postChat(page, hiddenContent)
  expect(hiddenResponse.ok()).toBe(true)
  await narrowToggle.click()
  await expect(reopenedLog).toBeVisible()
  await expect(
    reopenedChat.getByText(hiddenContent, { exact: true }),
  ).toBeVisible()
  await expect(reopenedChat.getByRole('status')).toBeEmpty()
  const narrowLiveContent = `${prefix} arrived at narrow live end`
  const narrowLiveResponse = await postChat(page, narrowLiveContent)
  expect(narrowLiveResponse.ok()).toBe(true)
  await expect(
    reopenedChat.getByText(narrowLiveContent, { exact: true }),
  ).toBeVisible()
  await expect
    .poll(() => reopenedLog.getAttribute('data-at-bottom'))
    .toBe('true')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: 'Enter theater mode' }).click()
  await expect(reopenedLog).toBeVisible()
  await expect(page.getByRole('main')).toHaveAttribute(
    'data-theater-mode',
    'true',
  )
  const theaterLiveContent = `${prefix} arrived in theater mode`
  const theaterLiveResponse = await postChat(page, theaterLiveContent)
  expect(theaterLiveResponse.ok()).toBe(true)
  await expect(
    reopenedChat.getByText(theaterLiveContent, { exact: true }),
  ).toBeVisible()
  await expect
    .poll(() => reopenedLog.getAttribute('data-at-bottom'))
    .toBe('true')
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
    await senderChat
      .getByRole('textbox', { name: 'Chat message' })
      .fill(content)
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
      .poll(() =>
        receiverChat.getByRole('log').getAttribute('data-realtime-state'),
      )
      .not.toBe('connected')

    const reconciledContent = `reconciled Chat message ${randomUUID()}`
    await senderChat
      .getByRole('textbox', { name: 'Chat message' })
      .fill(reconciledContent)
    await senderChat.getByRole('button', { name: 'Send' }).click()

    await expect(senderChat.getByText('Delayed', { exact: true })).toBeVisible()
    await expect(
      senderChat.getByText('Reconnecting. Message delivery is delayed.'),
    ).toBeVisible()
    runDocker('start', centrifugoContainer)
    await waitForCentrifugo()
    await expect(senderChat.getByText('Delayed', { exact: true })).toHaveCount(
      0,
    )
    await expect(
      senderChat.getByText(reconciledContent, { exact: true }),
    ).toHaveCount(1)
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

test('shows Sending immediately and retries failed requests with one submission key', async ({
  page,
}) => {
  await signInAsAdministrator(page)
  const chat = page.getByRole('complementary', { name: 'Chat' })
  const input = chat.getByRole('textbox', { name: 'Chat message' })
  const content = `retry-${randomUUID()}`
  const keys: string[] = []
  let release: () => void = () => undefined
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  let first = true
  await page.route('**/chat/messages', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    keys.push(route.request().postDataJSON().clientIdempotencyKey)
    if (first) {
      first = false
      await released
      await route.abort('failed')
    } else if (keys.length === 2) {
      await route.abort('failed')
    } else {
      await route.continue()
    }
  })
  await input.fill(content)
  await input.press('Enter')
  await expect(
    chat.getByRole('log').getByText(content, { exact: true }),
  ).toBeVisible()
  await expect(chat.getByText('Sending', { exact: true })).toBeVisible()
  release()
  await expect(chat.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(input).toHaveValue(content)
  await chat.getByRole('button', { name: 'Retry' }).click()
  await expect(chat.getByRole('button', { name: 'Retry' })).toBeEnabled()
  await expect(input).toHaveValue(content)
  await chat.getByRole('button', { name: 'Retry' }).click()
  await expect(input).toHaveValue('')
  await expect(
    chat.getByRole('log').getByText(content, { exact: true }),
  ).toHaveCount(1)
  expect(keys).toHaveLength(3)
  expect(new Set(keys).size).toBe(1)
  const history = await (
    await page.request.get('/api/channels/live/chat/messages')
  ).json()
  expect(
    history.messages.filter(
      (message: { content: string }) => message.content === content,
    ),
  ).toHaveLength(1)
})

test('enforces the account limit across tabs and requires a manual send after the countdown', async ({
  page,
  context,
}) => {
  await signInAsAdministrator(page)
  const otherTab = await context.newPage()
  await otherTab.goto('/watch/live')
  for (let index = 0; index < 3; index += 1) {
    expect(
      (
        await page.request.post('/api/channels/live/chat/messages', {
          data: {
            content: `burst ${index}`,
            clientIdempotencyKey: randomUUID(),
          },
        })
      ).status(),
    ).toBe(201)
  }
  const chat = otherTab.getByRole('complementary', { name: 'Chat' })
  const input = chat.getByRole('textbox', { name: 'Chat message' })
  let sends = 0
  otherTab.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/chat/messages'))
      sends += 1
  })
  await input.fill('keep this rate-limited draft')
  await input.press('Enter')
  await expect(chat.getByText(/Try again in \d+ seconds/)).toBeVisible()
  await expect(
    chat.getByRole('button', { name: 'Send', exact: true }),
  ).toBeDisabled()
  await expect(input).toHaveValue('keep this rate-limited draft')
  await expect(
    chat.getByRole('button', { name: 'Send', exact: true }),
  ).toBeEnabled({ timeout: 12_000 })
  expect(sends).toBe(1)
  await input.press('Enter')
  await expect(input).toHaveValue('')
  expect(sends).toBe(2)
  await otherTab.close()
})

test('keeps drafts in memory and handles focus, player shortcuts, and input-method composition', async ({
  page,
}) => {
  await signInAsAdministrator(page)
  const chat = page.getByRole('complementary', { name: 'Chat' })
  const input = chat.getByRole('textbox', { name: 'Chat message' })
  await expect(input).toBeEnabled()
  await expect(input).not.toBeFocused()
  const draft = `memory-${randomUUID()}`
  await input.fill(draft)
  await chat.getByRole('button', { name: 'Close Chat' }).click()
  const restore = page.getByRole('button', { name: 'Open Chat' })
  await expect(restore).toBeFocused()
  await restore.click()
  await expect(input).toBeFocused()
  await expect(input).toHaveValue(draft)
  const video = page.locator('video')
  const mediaBefore = await video.evaluate((element: HTMLVideoElement) => ({
    muted: element.muted,
    volume: element.volume,
    paused: element.paused,
  }))
  await input.press('m')
  await input.press('k')
  await input.press('f')
  await input.press('t')
  await input.press('Space')
  await input.press('ArrowUp')
  expect(
    await video.evaluate((element: HTMLVideoElement) => ({
      muted: element.muted,
      volume: element.volume,
      paused: element.paused,
    })),
  ).toEqual(mediaBefore)
  expect(await page.evaluate(() => document.fullscreenElement !== null)).toBe(
    false,
  )
  await expect(page.getByRole('main')).not.toHaveAttribute(
    'data-theater-mode',
    'true',
  )
  let sends = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/chat/messages'))
      sends += 1
  })
  await input.dispatchEvent('compositionstart')
  await input.press('Enter')
  await input.dispatchEvent('compositionend')
  expect(sends).toBe(0)
  await input.press('Enter')
  await expect(input).toHaveValue('')
  expect(sends).toBe(1)
  await input.fill(draft)
  expect(
    await page.evaluate(
      (text) =>
        JSON.stringify({ ...localStorage, ...sessionStorage }).includes(text),
      draft,
    ),
  ).toBe(false)
  await page.reload()
  await expect(input).toHaveValue('')
  await input.fill(draft)
  await page.getByRole('link', { name: /Watch Alpha Channel/ }).click()
  await expect(page).toHaveURL('/watch/alpha')
  await page.getByRole('link', { name: /Watch Live stream/ }).click()
  await expect(page).toHaveURL('/watch/live')
  await expect(input).toHaveValue('')
  await page.setViewportSize({ width: 760, height: 900 })
  const toggle = chat.getByRole('button', { name: 'Chat', exact: true })
  await toggle.click()
  await expect(input).toBeFocused()
  await input.fill(draft)
  await toggle.click()
  await toggle.click()
  await expect(input).toHaveValue(draft)
  await expect(input).toBeFocused()
})

test('reconciles a publication before a lost HTTP response without a duplicate or Retry', async ({
  page,
}) => {
  await signInAsAdministrator(page)
  const chat = page.getByRole('complementary', { name: 'Chat' })
  await expect(chat.getByRole('log')).toHaveAttribute(
    'data-realtime-state',
    'connected',
  )
  const input = chat.getByRole('textbox', { name: 'Chat message' })
  const content = `early-publication-${randomUUID()}`
  let release: () => void = () => undefined
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  let committed: () => void = () => undefined
  const commit = new Promise<void>((resolve) => {
    committed = resolve
  })
  await page.route('**/chat/messages', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    expect((await route.fetch()).status()).toBe(201)
    committed()
    await released
    await route.abort('failed')
  })
  await input.fill(content)
  await input.press('Enter')
  await commit
  await expect(
    chat.getByRole('log').getByText(content, { exact: true }),
  ).toHaveCount(1)
  await expect(chat.getByText('Sending', { exact: true })).toHaveCount(0)
  await expect(input).toHaveValue('')
  release()
  await expect(
    chat.getByRole('button', { name: 'Send', exact: true }),
  ).toBeDisabled()
  await expect(chat.getByRole('button', { name: 'Retry' })).toHaveCount(0)
  await expect(
    chat.getByRole('log').getByText(content, { exact: true }),
  ).toHaveCount(1)
})

test('removes a message through its menu and replaces it for another connected participant', async ({
  page,
  browser,
}) => {
  await signInAsAdministrator(page)
  const otherContext = await browser.newContext()
  const other = await otherContext.newPage()
  try {
    await other.goto('/login?returnTo=/watch/live')
    await other.getByLabel('Username').fill('chat_friend')
    await other.getByLabel('Password').fill('e2e-participant-password')
    await other.getByRole('button', { name: 'Sign in' }).click()
    await expect(other).toHaveURL('/watch/live')
    await expect(
      page.getByRole('log', { name: 'Chat messages' }),
    ).toHaveAttribute('data-realtime-state', 'connected')
    await expect(
      other.getByRole('log', { name: 'Chat messages' }),
    ).toHaveAttribute('data-realtime-state', 'connected')
    const response = await postChat(page, 'Message to remove')
    expect(response.status()).toBe(201)
    const { message } = await response.json()
    const row = page.locator(`[data-message-id="${message.id}"]`)
    const otherRow = other.locator(`[data-message-id="${message.id}"]`)
    await expect(otherRow).toContainText('Message to remove')
    const action = row.getByRole('button', { name: 'Message actions' })
    await action.click()
    await expect(
      page.getByRole('menuitem', { name: 'Remove message' }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(action).toBeFocused()
    await action.click()
    await page.getByRole('menuitem', { name: 'Remove message' }).click()
    const dialog = page.getByRole('dialog', { name: 'Remove message' })
    await dialog.getByLabel('Category').selectOption('Other')
    await expect(
      dialog.getByRole('button', { name: 'Confirm removal' }),
    ).toBeDisabled()
    await dialog
      .getByLabel('Private note')
      .fill('Reason visible only to moderators')
    await dialog.getByRole('button', { name: 'Confirm removal' }).click()
    await expect(dialog).not.toBeVisible()
    await expect(row).toContainText('Message removed')
    await expect(otherRow).toContainText('Message removed')
    await expect(otherRow).not.toContainText('Message to remove')
    const { token } = await (
      await page.request.get('/api/channels/live/chat/token')
    ).json()
    const { channels } = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString(),
    ) as { channels: string[] }
    const cachedHistory = await fetch('http://127.0.0.1:3800/api/history', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'e2e-centrifugo-api-key-that-is-at-least-32-characters',
      },
      body: JSON.stringify({
        channel: channels.find((value) => value.startsWith('chat:')),
        limit: 300,
      }),
    })
    const cached = await cachedHistory.text()
    expect(cached).not.toContain('Message to remove')
    expect(cached).toContain('"removed":true')

    await expect(
      otherRow.getByRole('button', { name: 'Message actions' }),
    ).toHaveCount(0)
    expect(
      (
        await other.request.get(
          `/api/channels/live/chat/messages/${message.id}/removal`,
        )
      ).status(),
    ).toBe(403)
    await expect(action).toBeFocused()
    await action.click()
    await page
      .getByRole('menuitem', { name: 'Inspect removed message' })
      .click()
    const evidence = page.getByRole('dialog', { name: 'Removed message' })
    await expect(evidence).toContainText('Message to remove')
    await expect(evidence).toContainText('Reason visible only to moderators')
    await evidence.getByRole('button', { name: 'Close' }).click()
    await other.reload()
    await expect(otherRow).toContainText('Message removed')
    await expect(otherRow).not.toContainText('Message to remove')
  } finally {
    await otherContext.close()
  }
})

for (const preset of [
  { minutes: 10, label: '10 minutes', category: 'Spam' },
  { minutes: 60, label: '1 hour', category: 'Harassment' },
  { minutes: 1440, label: '24 hours', category: 'Other' },
]) {
  test(`applies a ${preset.label} Chat timeout with private feedback and restores sending at expiry`, async ({
    page,
    browser,
  }) => {
    await signInAsAdministrator(page)
    const otherContext = await browser.newContext()
    const other = await otherContext.newPage()
    try {
      await other.goto('/login?returnTo=/watch/live')
      await other.getByLabel('Username').fill('chat_friend')
      await other.getByLabel('Password').fill('e2e-participant-password')
      await other.getByRole('button', { name: 'Sign in' }).click()
      await expect(other).toHaveURL('/watch/live')
      const log = other.getByRole('log', { name: 'Chat messages' })
      await expect(log).toHaveAttribute('data-realtime-state', 'connected')
      const { message: older } = await (
        await postChat(other, 'Older retained message')
      ).json()
      const database = new Database(chatDatabasePath)
      database
        .prepare('UPDATE chat_message SET created_at = ? WHERE id = ?')
        .run(Date.now() - 601_000, older.id)
      database.close()
      const { message } = await (
        await postChat(other, 'Recent disruptive message')
      ).json()
      await page
        .locator(`[data-message-id="${message.id}"]`)
        .getByRole('button', { name: 'Message actions' })
        .click()
      await page.getByRole('menuitem', { name: 'Apply Chat timeout' }).click()
      const dialog = page.getByRole('dialog', { name: 'Apply Chat timeout' })
      await dialog.getByLabel('Duration').selectOption(String(preset.minutes))
      await dialog.getByLabel('Category').selectOption(preset.category)
      if (preset.category === 'Other') {
        await expect(
          dialog.getByRole('button', { name: 'Confirm timeout' }),
        ).toBeDisabled()
      }
      await dialog.getByLabel('Private note').fill('Private timeout evidence')
      await dialog.getByRole('button', { name: 'Confirm timeout' }).click()
      await expect(dialog).not.toBeVisible()
      const composer = other.getByRole('textbox', { name: 'Chat message' })
      await expect(composer).toBeDisabled()
      const feedback = other.getByRole('status', { name: 'Chat timeout' })
      await expect(feedback).toContainText(preset.category)
      await expect(feedback).toContainText('remaining')
      await expect(feedback).not.toContainText(/power|Private timeout evidence/)
      await expect(
        page.getByRole('status', { name: 'Chat timeout' }),
      ).toHaveCount(0)
      await expect(log).toHaveAttribute('data-realtime-state', 'connected')
      await expect(
        other.locator(`[data-message-id="${message.id}"]`),
      ).toContainText('Message removed')
      await expect(
        other.locator(`[data-message-id="${older.id}"]`),
      ).toContainText('Older retained message')
      const state = await (
        await other.request.get('/api/channels/live/chat/state')
      ).json()
      expect(
        Date.parse(state.restriction.expiresAt) - Date.parse(state.serverTime),
      ).toBeGreaterThan(preset.minutes * 60_000 - 15_000)
      expect((await postChat(other, 'Direct request bypass')).status()).toBe(
        403,
      )
      await postChat(page, 'Reading is still available')
      await expect(log).toContainText('Reading is still available')
      await other.reload()
      await expect(composer).toBeDisabled()
      await expect(feedback).toContainText(preset.category)
      // Shorten only the fixture's expiry, then reconnect to load its current state.
      await otherContext.setOffline(true)
      await expect(log).not.toHaveAttribute('data-realtime-state', 'connected')
      const expiryDatabase = new Database(chatDatabasePath)
      expiryDatabase
        .prepare(
          `UPDATE chat_moderation_record SET expires_at = ? WHERE id IN (SELECT record_id FROM chat_restriction WHERE account_id = 'e2e-chat-participant')`,
        )
        .run(Date.now() + 4_000)
      expiryDatabase.close()
      await otherContext.setOffline(false)
      await expect(log).toHaveAttribute('data-realtime-state', 'connected')
      await expect(feedback).toContainText(preset.category)
      await expect(composer).toBeEnabled({ timeout: 10_000 })
      await expect(feedback).toHaveCount(0)
      await composer.fill('Sending restored after expiry')
      await other.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(
        page.getByRole('log', { name: 'Chat messages' }),
      ).toContainText('Sending restored after expiry')
    } finally {
      await otherContext.close()
    }
  })
}
