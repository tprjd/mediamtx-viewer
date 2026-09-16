import {
  expect,
  test,
  type Locator,
  type Page,
  type BrowserContext,
} from '@playwright/test'
import Database from 'better-sqlite3'
import { execFile, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

const centrifugoContainer = 'mediamtx-viewer-e2e-centrifugo'
const chatDatabasePath = resolve('.data/e2e-chat.sqlite')
const authDatabasePath = resolve('.data/e2e-chat-auth.sqlite')

test.describe.configure({ mode: 'serial' })

test.beforeEach(() => {
  const database = new Database(chatDatabasePath)
  database.pragma('foreign_keys = ON')
  database.prepare('DELETE FROM chat_room').run()
  database.prepare('DELETE FROM chat_moderation_record').run()
  database.close()
})

async function prepareChatPlayback(page: Page) {
  await page.addInitScript(() =>
    sessionStorage.setItem('mediamtx-viewer:playback-mode', 'smooth'),
  )
  const playlist = readFileSync(
    resolve('tests/e2e/fixtures/chat-playback/index.m3u8'),
    'utf8',
  )
    .replace('#EXT-X-PLAYLIST-TYPE:VOD\n', '')
    .replace('#EXT-X-ENDLIST\n', '')
    .split('#EXTINF:')
  let startedAt = 0
  const media = readFileSync(
    resolve('tests/e2e/fixtures/chat-playback/media.mp4'),
  )
  await page.route('**/media/hls/live/**', async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('.m3u8')) {
      startedAt ||= Date.now()
      const available = 10 + Math.floor((Date.now() - startedAt) / 2000)
      const body =
        playlist[0] +
        playlist
          .slice(1, available + 1)
          .map((segment) => `#EXTINF:${segment}`)
          .join('')
      return route.fulfill({
        contentType: 'application/vnd.apple.mpegurl',
        body,
      })
    }
    const range = /^bytes=(\d+)-(\d+)$/.exec(
      route.request().headers().range ?? '',
    )
    const start = range ? Number(range[1]) : 0
    const end = range ? Number(range[2]) : media.length - 1
    await route.fulfill({
      status: range ? 206 : 200,
      contentType: 'video/mp4',
      body: media.subarray(start, end + 1),
      headers: range
        ? { 'content-range': `bytes ${start}-${end}/${media.length}` }
        : {},
    })
  })
}

async function observePlayback(page: Page) {
  const video = page.locator('video')
  await expect
    .poll(() =>
      video.evaluate(
        (element: HTMLVideoElement) =>
          !element.paused && element.currentTime > 1,
      ),
    )
    .toBe(true)
  const handle = await video.elementHandle()
  if (!handle) throw new Error('Player video is missing')
  const initial = await handle.evaluate((element) => {
    const video = element as HTMLVideoElement
    video.dataset.chatInterruptions = '0'
    for (const event of ['pause', 'emptied', 'abort'])
      video.addEventListener(event, () => {
        video.dataset.chatInterruptions = String(
          Number(video.dataset.chatInterruptions) + 1,
        )
      })
    return { time: video.currentTime, source: video.currentSrc }
  })
  return async () => {
    const current = await handle.evaluate((element) => {
      const video = element as HTMLVideoElement
      return {
        connected: video.isConnected,
        paused: video.paused,
        time: video.currentTime,
        source: video.currentSrc,
        interruptions: video.dataset.chatInterruptions,
      }
    })
    expect(current, JSON.stringify({ initial, current })).toMatchObject({
      connected: true,
      paused: false,
      source: initial.source,
      interruptions: '0',
    })
    expect(current.time).toBeGreaterThan(initial.time + 0.5)
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem('mediamtx-viewer:playback-mode'),
      ),
    ).toBe('smooth')
  }
}

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
  | Awaited<ReturnType<BrowserContext['cookies']>>
  | undefined

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
  await prepareChatPlayback(sender)
  await prepareChatPlayback(receiver)
  try {
    await signInAsAdministrator(sender)

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
    const assertPlaybackContinues = await observePlayback(receiver)

    runDocker('stop', '--time', '1', centrifugoContainer)
    await expect
      .poll(() =>
        receiverChat.getByRole('log').getAttribute('data-realtime-state'),
      )
      .not.toBe('connected')

    const health = await receiver.request.get('/api/health')
    expect(health.status()).toBe(200)
    expect(await health.json()).toMatchObject({
      chat: {
        status: 'degraded',
        faults: expect.arrayContaining(['centrifugo']),
      },
    })
    expect(
      (await receiver.request.get('/api/channels/live/status')).status(),
    ).toBe(200)
    await expect(receiverChat.getByText(content, { exact: true })).toBeVisible()

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
    await assertPlaybackContinues()
  } finally {
    runDocker('start', centrifugoContainer)
    await senderContext.close()
    await receiverContext.close()
  }
})

test('keeps the player and loaded history when the Chat database cannot accept commands', async ({
  page,
}) => {
  await prepareChatPlayback(page)
  await signInAsAdministrator(page)
  const chat = page.getByRole('complementary', { name: 'Chat' })
  const content = `history during database failure ${randomUUID()}`
  const sent = await postChat(page, content)
  expect(sent.status()).toBe(201)
  const { message } = await sent.json()
  await expect(chat.getByText(content, { exact: true })).toBeVisible()
  await expect(
    chat.getByRole('button', { name: 'Active Chat restrictions' }),
  ).toBeVisible()
  const assertPlaybackContinues = await observePlayback(page)
  const database = new Database(chatDatabasePath)
  database.exec('ALTER TABLE chat_room RENAME TO unavailable_chat_room')
  try {
    await expect(
      chat.getByRole('textbox', { name: 'Chat message' }),
    ).toBeDisabled({ timeout: 10_000 })
    await expect(
      chat.getByRole('button', { name: 'Active Chat restrictions' }),
    ).toHaveCount(0)
    await expect(chat.getByText(content, { exact: true })).toBeVisible()
    expect((await postChat(page, 'cannot be stored')).status()).toBe(503)
    expect(
      (await page.request.get('/api/channels/live/chat/messages')).status(),
    ).toBe(503)
    expect(
      (
        await page.request.post(
          `/api/channels/live/chat/messages/${message.id}/removal`,
          { data: { category: 'Spam' } },
        )
      ).status(),
    ).toBe(503)
    const health = await page.request.get('/api/health')
    expect(health.status()).toBe(200)
    expect(await health.json()).toMatchObject({
      status: 'ok',
      chat: { status: 'unavailable' },
    })
    const status = await page.request.get('/api/channels/live/status')
    expect(status.status()).toBe(200)
    expect(await status.json()).toMatchObject({ status: { live: true } })
    await assertPlaybackContinues()
    await expect(page).toHaveURL('/watch/live')
    const statistics = await page.context().newPage()
    await statistics.goto('/statistics')
    await expect(
      statistics.getByRole('region', { name: 'Chat health' }),
    ).toContainText('Chat database is unavailable')
    await statistics.close()
  } finally {
    database.exec('ALTER TABLE unavailable_chat_room RENAME TO chat_room')
    database.close()
  }
  await expect(chat.getByRole('textbox', { name: 'Chat message' })).toBeEnabled(
    { timeout: 10_000 },
  )
  await assertPlaybackContinues()
})

test('keeps history, Channel status, and the player at the Chat storage limit', async ({
  page,
}) => {
  await prepareChatPlayback(page)
  await signInAsAdministrator(page)
  const chat = page.getByRole('complementary', { name: 'Chat' })
  const content = `history during storage limit ${randomUUID()}`
  expect((await postChat(page, content)).status()).toBe(201)
  await expect(chat.getByText(content, { exact: true })).toBeVisible()
  const assertPlaybackContinues = await observePlayback(page)
  const database = new Database(chatDatabasePath)
  try {
    database.exec(
      'CREATE TABLE capacity_probe (payload BLOB); INSERT INTO capacity_probe VALUES (zeroblob(34603008))',
    )
    await expect(
      chat.getByRole('textbox', { name: 'Chat message' }),
    ).toBeDisabled({ timeout: 10_000 })
    await expect(
      chat.getByText('Chat storage limit reached. Sending is paused.'),
    ).toBeVisible()
    const rejected = await postChat(page, 'blocked by capacity')
    expect(rejected.status()).toBe(503)
    expect(await rejected.json()).toMatchObject({
      error: 'Chat storage limit reached.',
    })
    const history = await page.request.get('/api/channels/live/chat/messages')
    expect(history.status()).toBe(200)
    expect(JSON.stringify(await history.json())).toContain(content)
    expect((await page.request.get('/api/channels/live/status')).status()).toBe(
      200,
    )
    expect((await page.request.get('/api/health')).status()).toBe(200)
    await expect(chat.getByText(content, { exact: true })).toBeVisible()
    await assertPlaybackContinues()
  } finally {
    database.exec('DROP TABLE IF EXISTS capacity_probe; VACUUM')
    database.pragma('wal_checkpoint(TRUNCATE)')
    database.close()
  }
  await expect(chat.getByRole('textbox', { name: 'Chat message' })).toBeEnabled(
    { timeout: 10_000 },
  )
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
      expiryDatabase
        .prepare(
          "UPDATE chat_restriction SET expires_at = ? WHERE account_id = 'e2e-chat-participant'",
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

test('manages Chat bans, allowed and rejected reversal, current badges, and administrator records', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000)
  const authDatabase = new Database(authDatabasePath)
  const original = authDatabase
    .prepare("SELECT owner_user_id AS owner FROM channel WHERE slug = 'live'")
    .get() as { owner: string }
  authDatabase
    .prepare(
      "UPDATE channel SET owner_user_id = 'e2e-chat-participant' WHERE slug = 'live'",
    )
    .run()
  authDatabase.close()
  const ownerContext = await browser.newContext()
  const owner = await ownerContext.newPage()
  try {
    await signInAsAdministrator(page)
    await owner.goto('/login?returnTo=/watch/live')
    await owner.getByLabel('Username').fill('chat_friend')
    await owner.getByLabel('Password').fill('e2e-participant-password')
    await owner.getByRole('button', { name: 'Sign in' }).click()
    await expect(owner).toHaveURL('/watch/live')
    const log = owner.getByRole('log', { name: 'Chat messages' })
    await expect(log).toHaveAttribute('data-realtime-state', 'connected')
    const { message: older } = await (
      await postChat(owner, 'Retained owner message')
    ).json()
    const database = new Database(chatDatabasePath)
    database
      .prepare('UPDATE chat_message SET created_at = ? WHERE id = ?')
      .run(Date.now() - 601_000, older.id)
    database.close()
    const oldRow = page.locator(`[data-message-id="${older.id}"]`)
    await expect(oldRow.getByText('Owner', { exact: true })).toBeVisible({
      timeout: 10_000,
    })
    const roles = new Database(authDatabasePath)
    roles
      .prepare(
        "UPDATE user SET role = 'admin' WHERE id = 'e2e-chat-participant'",
      )
      .run()
    await expect(oldRow.getByText('Admin', { exact: true })).toBeVisible({
      timeout: 10_000,
    })
    roles
      .prepare(
        "UPDATE user SET role = 'user' WHERE id = 'e2e-chat-participant'",
      )
      .run()
    roles.close()
    await expect(oldRow.getByText('Admin', { exact: true })).toHaveCount(0, {
      timeout: 10_000,
    })

    const { message } = await (await postChat(owner, 'Ban target')).json()
    await owner
      .locator(`[data-message-id="${message.id}"]`)
      .getByRole('button', { name: 'Message actions' })
      .click()
    await owner.getByRole('menuitem', { name: 'Apply Chat ban' }).click()
    const banDialog = owner.getByRole('dialog', { name: 'Apply Chat ban' })
    await banDialog.getByLabel('Category').selectOption('Other')
    await expect(
      banDialog.getByRole('button', { name: 'Confirm ban' }),
    ).toBeDisabled()
    await banDialog.getByLabel('Private note').fill('Private ban evidence')
    await banDialog.getByRole('button', { name: 'Confirm ban' }).click()
    await expect(banDialog).not.toBeVisible()
    const composer = owner.getByRole('textbox', { name: 'Chat message' })
    const feedback = owner.getByRole('status', { name: 'Chat ban' })
    await expect(composer).toBeDisabled()
    await expect(feedback).toContainText('Other. Indefinite')
    await expect(feedback).not.toContainText(/Private|power/)
    await expect(log).toHaveAttribute('data-realtime-state', 'connected')
    await expect(
      owner.locator(`[data-message-id="${message.id}"]`),
    ).toContainText('Message removed')
    await expect(oldRow).toContainText('Retained owner message')
    expect((await postChat(owner, 'HTTP bypass')).status()).toBe(403)
    await postChat(page, 'Reading remains available')
    await expect(log).toContainText('Reading remains available')
    await ownerContext.setOffline(true)
    await expect(log).not.toHaveAttribute('data-realtime-state', 'connected')
    await ownerContext.setOffline(false)
    await expect(log).toHaveAttribute('data-realtime-state', 'connected')
    await expect(feedback).toContainText('Indefinite')
    await owner
      .getByRole('button', { name: 'Active Chat restrictions', exact: true })
      .click()
    const panel = owner.getByRole('dialog', {
      name: 'Active Chat restrictions',
    })
    await expect(panel).toContainText('Chat Friend')
    await panel.getByRole('button', { name: 'Lift restriction' }).click()
    await expect(panel).toContainText('No active Chat restrictions.')
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(composer).toBeEnabled()

    // An administrator's restriction cannot be reversed by the Channel owner.
    const { message: adminTarget } = await (
      await postChat(page, 'Administrator target')
    ).json()
    expect(
      (
        await page.request.post(
          `/api/channels/live/chat/messages/${adminTarget.id}/ban`,
          { data: { category: 'Spam' } },
        )
      ).status(),
    ).toBe(200)
    await owner
      .getByRole('button', { name: 'Active Chat restrictions', exact: true })
      .click()
    await expect(
      panel.getByRole('button', { name: 'Lift restriction' }),
    ).toBeDisabled()
    await expect(panel).toContainText('Only an administrator')
    const active = await (
      await page.request.get('/api/channels/live/chat/restrictions')
    ).json()
    expect(
      (
        await owner.request.post('/api/channels/live/chat/restrictions', {
          data: { restrictionId: active.restrictions[0].id },
        })
      ).status(),
    ).toBe(403)
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    expect(
      (
        await page.request.post('/api/channels/live/chat/restrictions', {
          data: { restrictionId: active.restrictions[0].id },
        })
      ).status(),
    ).toBe(200)

    const { message: ownerTarget } = await (
      await postChat(owner, 'Owner authority target')
    ).json()
    expect(
      (
        await page.request.post(
          `/api/channels/live/chat/messages/${ownerTarget.id}/ban`,
          { data: { category: 'Harassment' } },
        )
      ).status(),
    ).toBe(200)
    await expect(composer).toBeDisabled()
    await expect(
      owner.getByRole('button', {
        name: 'Active Chat restrictions',
        exact: true,
      }),
    ).toHaveCount(0)
    await expect(oldRow.getByText('Owner', { exact: true })).toHaveCount(0, {
      timeout: 10_000,
    })
    await page
      .getByRole('button', { name: 'Active Chat restrictions', exact: true })
      .click()
    const adminPanel = page.getByRole('dialog', {
      name: 'Active Chat restrictions',
    })
    await expect(adminPanel).toContainText('Chat Friend')
    await adminPanel.getByRole('button', { name: 'Lift restriction' }).click()
    await adminPanel.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(composer).toBeEnabled()
    await expect(
      owner.getByRole('button', {
        name: 'Active Chat restrictions',
        exact: true,
      }),
    ).toBeVisible()
    await expect(oldRow.getByText('Owner', { exact: true })).toBeVisible({
      timeout: 10_000,
    })
    await composer.fill('Sending restored by reversal')
    await owner.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(
      page.getByRole('log', { name: 'Chat messages' }),
    ).toContainText('Sending restored by reversal')

    expect(
      (await owner.request.get('/api/admin/chat/moderation')).status(),
    ).toBe(403)
    const historyDatabase = new Database(chatDatabasePath)
    const { roomId } = historyDatabase
      .prepare('SELECT room_id AS roomId FROM chat_message WHERE id = ?')
      .get(older.id) as { roomId: string }
    for (let index = 0; index < 51; index++) {
      historyDatabase
        .prepare(
          `INSERT INTO chat_moderation_record (id, action, category, actor_account_id, target_account_id, room_id, created_at) VALUES (?, 'reversal', 'Spam', ?, 'e2e-chat-participant', ?, ?)`,
        )
        .run(
          randomUUID(),
          original.owner,
          roomId,
          Date.now() - 3600_000 - index,
        )
    }
    historyDatabase.close()
    await page.goto('/admin/chat')
    await expect(
      page.getByRole('heading', {
        name: 'Chat moderation records',
        exact: true,
      }),
    ).toBeVisible()
    const table = page.getByRole('table')
    await expect(table).toContainText('Chat ban')
    await expect(table).toContainText('Reversal')
    await expect(table).toContainText('reversed')
    await expect(table).not.toContainText('Private ban evidence')
    await page.getByRole('button', { name: 'Next page' }).click()
    await expect(table).not.toContainText('Chat ban')
    await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled()
    await page.getByRole('button', { name: 'Previous page' }).click()
    await expect(table).toContainText('Chat ban')

    await page
      .getByRole('button', {
        name: 'Clear Chat moderation records',
        exact: true,
      })
      .click()
    const clearDialog = page.getByRole('dialog', {
      name: 'Clear Chat moderation records?',
    })
    await clearDialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(table).toBeVisible()
    await page
      .getByRole('button', {
        name: 'Clear Chat moderation records',
        exact: true,
      })
      .click()
    await clearDialog.getByRole('button', { name: 'Confirm clear' }).click()
    await expect(
      page.getByText('No Chat moderation records.', { exact: true }),
    ).toBeVisible()
  } finally {
    await ownerContext.close()
    const restore = new Database(authDatabasePath)
    restore
      .prepare("UPDATE channel SET owner_user_id = ? WHERE slug = 'live'")
      .run(original.owner)
    restore
      .prepare(
        "UPDATE user SET role = 'user' WHERE id = 'e2e-chat-participant'",
      )
      .run()
    restore.close()
  }
})

test('restore drill keeps authentication and playback available during an independent Chat restore', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await prepareChatPlayback(page)
  await signInAsAdministrator(page)
  const verifyPlayback = await observePlayback(page)
  const chat = page.getByRole('complementary', { name: 'Chat' })
  const retained = `before-backup-${randomUUID()}`
  const later = `after-backup-${randomUUID()}`
  expect((await postChat(page, retained)).ok()).toBe(true)
  await expect(chat.getByText(retained, { exact: true })).toBeVisible()
  const backupDirectory = mkdtempSync(resolve(tmpdir(), 'chat-restore-drill-'))
  const env = {
    ...process.env,
    AUTH_DB_PATH: authDatabasePath,
    CHAT_DB_PATH: chatDatabasePath,
    AUTH_BACKUP_DIR: backupDirectory,
    AUTH_BACKUP_KEY: Buffer.alloc(32, 17).toString('base64'),
    CHAT_RESTORE_CONFIRM: 'replace',
    CHAT_RESTORE_URL: 'http://[::1]:3299',
    INTERNAL_AUTH_SECRET: 'e2e-chat-internal-secret-at-least-32-characters',
  }
  let paused = false
  try {
    const db = new Database(chatDatabasePath)
    db.prepare(
      `INSERT INTO chat_message
      (id, room_id, room_sequence, account_id, profile_name, author_tag, content, created_at)
      SELECT 'restore-expired', room_id, 10000, account_id, profile_name, author_tag, 'restore-expired-content', ?
      FROM chat_message LIMIT 1`,
    ).run(Date.now() - 8 * 86400000)
    db.close()
    // Make an older encrypted set in which this content was still retained.
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import { createBackupSet, backupPaths } from './scripts/database-backups.mjs'; console.log(await createBackupSet({ ...backupPaths(), now: new Date(Date.now() - 2 * 86400000) }))",
      ],
      { env },
    )
    const manifest = stdout.trim()
    expect((await postChat(page, later)).ok()).toBe(true)
    await expect(chat.getByText(later, { exact: true })).toBeVisible()
    // An authentication change made after backup must survive a Chat-only restore.
    const auth = new Database(authDatabasePath)
    auth
      .prepare(
        "UPDATE channel SET title = 'Restore drill marker' WHERE slug = 'alpha'",
      )
      .run()
    auth.close()
    runDocker('pause', centrifugoContainer)
    paused = true
    await expect(
      promisify(execFile)(
        process.execPath,
        ['scripts/restore-chat.mjs', manifest],
        { env },
      ),
    ).rejects.toThrow()
    expect(
      (await page.request.get('/api/channels/live/chat/messages')).status(),
    ).toBe(503)
    expect(
      (await page.request.get('/api/channels/live/chat/token')).status(),
    ).toBe(503)
    expect((await page.request.get('/api/auth/get-session')).ok()).toBe(true)
    expect((await page.request.get('/api/channels')).ok()).toBe(true)
    await verifyPlayback()
    runDocker('unpause', centrifugoContainer)
    paused = false
    await waitForCentrifugo()
    await promisify(execFile)(
      process.execPath,
      ['scripts/restore-chat.mjs', manifest],
      { env },
    )
    await expect(chat.getByText(retained, { exact: true })).toBeVisible()
    await expect(chat.getByText(later, { exact: true })).toHaveCount(0)
    const restored = new Database(chatDatabasePath)
    expect(
      restored
        .prepare("SELECT 1 FROM chat_message WHERE id = 'restore-expired'")
        .get(),
    ).toBeUndefined()
    restored.close()
    const currentAuth = new Database(authDatabasePath)
    expect(
      currentAuth
        .prepare("SELECT title FROM channel WHERE slug = 'alpha'")
        .get(),
    ).toEqual({ title: 'Restore drill marker' })
    currentAuth.close()
    const session = await (
      await page.request.get('/api/auth/get-session')
    ).json()
    expect(session.user.username).toBe('power')
    const connected = `after-restore-${randomUUID()}`
    expect((await postChat(page, connected)).ok()).toBe(true)
    await expect(chat.getByText(connected, { exact: true })).toBeVisible()
    await verifyPlayback()
  } finally {
    if (paused) runDocker('unpause', centrifugoContainer)
    rmSync(backupDirectory, { recursive: true, force: true })
  }
})
