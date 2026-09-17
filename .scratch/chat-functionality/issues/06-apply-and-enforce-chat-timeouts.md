# 06: Apply and enforce Chat timeouts

**What to build:** Let a Chat moderator temporarily stop a disruptive participant from sending while that participant keeps Viewing access and receives private restriction feedback.

**Blocked by:** 04: Handle Chat sending limits and failures; 05: Remove harmful Chat messages

**Status:** resolved

- [x] A Channel owner can apply a Chat timeout only in their own room
- [x] An administrator can apply a Chat timeout in any room, including to its Channel owner
- [x] A Channel owner cannot apply a Chat timeout to an administrator
- [x] The moderator can select 10 minutes, 1 hour, or 24 hours
- [x] The moderator selects Spam, Harassment, or Other under the agreed private-note rules
- [x] Applying a Chat timeout commits the restriction, Chat moderation record, affected Message removals, and delivery events atomically
- [x] Applying a Chat timeout replaces only the selected retained message with a tombstone, including when it is older than ten minutes
- [x] All other messages remain unchanged, including recent messages from the same participant
- [x] The restricted participant remains connected and can read the room
- [x] The restricted participant cannot send through the UI or a direct HTTP request
- [x] A private control event disables the affected participant's composer without a reload
- [x] The composer shows the category and remaining duration
- [x] The composer does not expose the moderator identity or private note
- [x] The room receives tombstones but no public Chat timeout announcement
- [x] A new or reconnected client receives the current restriction state
- [x] Expiry restores sending access without a page reload
- [x] An administrator's Chat timeout of a Channel owner also suspends that owner's Chat moderation authority
- [x] The Chat timeout does not change Streaming access or Viewing access
- [x] Concurrency tests prove that a send cannot pass after a committed Chat timeout
- [x] Authorization tests cover room ownership, administrator immunity, Channel-owner restriction, and suspended moderation authority
- [x] Browser tests cover every timeout preset, private feedback, retained reading, automatic tombstones, expiry, and restored sending

## Comments

- 2026-09-17: [Chat feedback issue 03](../../chat-feedback/issues/03-timeout-selected-message-only.md) supersedes the original ten-minute timeout removal rule. A timeout removes only the selected retained message. Chat bans retain their ten-minute removal window. The notes below describe the original implementation.
- 2026-09-16: Verified the existing implementation in commit `0aa357c`. Chat timeouts enforce all three presets, remove the previous ten minutes of messages atomically, deliver private restriction feedback, and restore sending at expiry. Administrator timeouts also suspend Channel-owner moderation authority.
- Validation passed: `npm run typecheck`, `npm run lint`, `npm test` with 44 files and 294 tests, and `npm run build -- --webpack`.
- Browser validation passed: `npx playwright test --project=chat-chromium --grep 'Chat timeout' --reporter=line`, with all three preset scenarios against Next.js, SQLite, and Centrifugo.
- Independent Standards and Spec reviews used Astra at medium effort. Neither review found an actionable issue.
