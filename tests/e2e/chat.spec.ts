import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

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
