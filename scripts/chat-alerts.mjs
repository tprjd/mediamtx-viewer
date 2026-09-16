import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const faultCodes = new Set([
  'configuration',
  'database',
  'centrifugo',
  'outbox',
  'database-limit',
  'disk-limit',
  'disk-check',
])

// Only fixed fault codes may enter operational messages. Never forward HTTP bodies or errors.
export async function checkChatAlerts({
  state,
  faults,
  uncheckedFaults = [],
  now,
  send,
  save,
}) {
  const active = new Set(faults.filter((fault) => faultCodes.has(fault)))
  for (const fault of active) {
    if (!state[fault]) {
      state[fault] = { since: now, notified: false }
      await save(state)
    }
    const entry = state[fault]
    if (!entry.notified && now - entry.since >= 300_000) {
      await send(`Chat fault active for five minutes: ${fault}.`)
      entry.notified = true
      await save(state)
    }
  }
  for (const fault of Object.keys(state)) {
    if (active.has(fault)) continue
    if (uncheckedFaults.includes(fault)) {
      // Keep alerted faults unresolved, but require a fresh observation window for new alerts.
      if (!state[fault].notified) state[fault].since = now
      continue
    }
    if (faultCodes.has(fault) && state[fault].notified) {
      await send(`Chat fault cleared: ${fault}.`)
    }
    delete state[fault]
    await save(state)
  }
}

export async function startChatAlerts({ viewerUrl, webhookUrl, stateFile }) {
  let state = {}
  try {
    state = JSON.parse(await readFile(stateFile, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(
        JSON.stringify({
          event: 'chat-alert',
          result: 'failed',
          code: 'STATE_READ',
        }),
      )
      return
    }
  }
  const save = async () => {
    await mkdir(dirname(stateFile), { recursive: true })
    await writeFile(`${stateFile}.tmp`, JSON.stringify(state), { mode: 0o600 })
    await rename(`${stateFile}.tmp`, stateFile)
  }
  const send = async (content) => {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) throw new Error('Discord request failed')
  }
  // This loop is independent of the Channel event stream and never overlaps checks.
  for (;;) {
    try {
      const response = await fetch(`${viewerUrl}/api/health`, {
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) throw new Error('Core health unavailable')
      const health = await response.json()
      if (!Array.isArray(health.chat?.faults))
        throw new Error('Chat health unavailable')
      await checkChatAlerts({
        state,
        faults: health.chat.faults,
        uncheckedFaults: health.chat.uncheckedFaults ?? [],
        now: Date.now(),
        send,
        save,
      })
      // Retry a failed state write even if the notification has already succeeded.
      await save()
    } catch {
      console.error(
        JSON.stringify({
          event: 'chat-alert',
          result: 'failed',
          code: 'CHECK_FAILED',
        }),
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000))
  }
}
