# 03: Browse retained Chat history

**What to build:** Let a participant browse seven days of Chat history without losing their reading position or slowing the browser as more pages load.

**Blocked by:** 01: Send and reload a Chat message

**Status:** resolved

- [x] History queries expose only entries from the previous seven days
- [x] Opening Chat loads the latest 100 visible entries and starts at the bottom
- [x] Scrolling upward loads the next 100 older entries through a stable room-sequence cursor
- [x] Loading an older page preserves the visible transcript anchor
- [x] The transcript shows an explicit end marker when it reaches the seven-day boundary
- [x] A virtualized list keeps the rendered document size bounded as history pages accumulate
- [x] New messages remain in view while the participant is at the bottom
- [x] New messages do not move the viewport while the participant reads older history
- [x] A New messages control returns the participant to the live end
- [x] Closing and reopening Chat fetches current history and starts at the bottom
- [x] Reopening Chat does not restore an old scroll position or show an unread count
- [x] Each message shows local time and the transcript adds date separators between local calendar days
- [x] The exact server timestamp remains available to assistive technology
- [x] The transcript is an accessible log
- [x] The log announces new messages only while Chat is visible and the participant is at the bottom
- [x] The log does not announce fetched history or new messages received while the participant reads older history
- [x] The history UI works in the existing desktop panel, narrow-screen disclosure, and theater-mode layout
- [x] Cursor integration tests cover ties, tombstone entries, expired entries, and concurrent new messages
- [x] Browser tests cover paging, viewport anchoring, virtualization, automatic scrolling, New messages, date boundaries, reopening, and accessible announcements

## Comments

- 2026-09-14: Implemented in `391e165`, `ea75edd`, `d155438`, and `9cac523`.
- Lint and type checking passed. Vitest passed with 250 tests. The webpack production build passed. The three Chat browser tests passed.
- The default Turbopack build could not create its internal process and port in this environment. The webpack production build verified the application instead.
- High-effort Sol Standards and Spec reviews found no standards issue. The final Spec finding about final-page anchoring was fixed and proved by the browser test. A final Sol re-review could not run because the Sol usage quota was exhausted.
