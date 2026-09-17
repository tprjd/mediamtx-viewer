import { test, expect, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

for (const width of [1440, 390]) {
  test(`triage09 theater control ${width}`, async ({ page }) => {
    await page.setViewportSize({width, height: 900})
    await prepareChatPlayback(page)
    await page.goto('/watch/live')
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Enter theater mode' }).click()
    const close = page.getByRole('button', {name: 'Close Chat'})
    if (await close.isVisible()) await close.click()
    const button = page.locator('[data-theater-chat-restore]')
    await expect(button).toBeVisible()
    await button.focus()
    const badge = page.locator('.protocol-badge')
    await expect(badge).toHaveCSS('opacity', '1')
    const buttonBox = (await button.boundingBox())!
    const badgeBox = (await badge.boundingBox())!
    const overlap = Math.max(0, Math.min(buttonBox.x+buttonBox.width,badgeBox.x+badgeBox.width)-Math.max(buttonBox.x,badgeBox.x))*Math.max(0,Math.min(buttonBox.y+buttonBox.height,badgeBox.y+badgeBox.height)-Math.max(buttonBox.y,badgeBox.y))
    await page.screenshot({path: `.data/triage09-${width}-visible.png`})
    await page.locator('video').evaluate(v => { (document.activeElement as HTMLElement)?.blur(); v.dispatchEvent(new Event('pointerleave', {bubbles: true})) })
    await page.mouse.move(0,899)
    await expect(page.locator('[data-player-controls]')).toHaveCSS('opacity','0', {timeout:10000})
    await expect(button).toBeVisible()
    await page.screenshot({path: `.data/triage09-${width}-hidden.png`})
    const evidence={width,buttonBox,badgeBox,overlap,buttonText:await button.innerText(),controlsOpacity:await page.locator('[data-player-controls]').evaluate(e=>getComputedStyle(e).opacity),buttonVisible:await button.isVisible(),badgeText:await badge.innerText()}
    writeFileSync(`.data/triage09-${width}.json`,JSON.stringify(evidence,null,2))
    expect(overlap).toBeGreaterThan(0)
  })
}
