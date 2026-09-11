import { expect, test } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const centrifugoContainer = 'mediamtx-viewer-e2e-centrifugo'

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

test('lets an active participant send and reload one Chat message', async ({
  page,
}) => {
  await page.goto('/login?returnTo=/watch/live')
  await page.getByLabel('Username').fill('power')
  await page.getByLabel('Password').fill('e2e-administrator-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL('/watch/live')

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
