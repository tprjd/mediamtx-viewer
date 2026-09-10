# 01: Send and reload a Chat message

**What to build:** Let an active account send one validated Chat message while a Channel is live and see the durable message again after a page reload. Keep the feature behind the global disabled-by-default flag.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] When CHAT_ENABLED is disabled, the watch page keeps the existing Chat placeholder and creates no Chat connection
- [x] When CHAT_ENABLED is enabled and the Channel is live, an active account sees a working message composer and transcript
- [x] An offline or unavailable Channel does not show or accept Chat
- [x] A pending or disabled account cannot load or send Chat messages
- [x] Chat data uses a dedicated SQLite database and does not add Chat tables to the authentication database
- [x] The Chat database stores stable account and Channel references without cross-database foreign keys
- [x] One Chat room belongs to one stable internal Channel identifier and survives publishing restarts
- [x] The server accepts single-line plain text with at most 500 Unicode grapheme clusters
- [x] The server normalizes Unicode, trims outside whitespace, replaces line breaks with spaces, and rejects empty or control-only content
- [x] The transcript renders URLs as plain text and does not create clickable links or rich previews
- [x] The server snapshots the profile name and stores the account ID internally when it accepts a Chat message
- [x] Each author has a stable room-specific Chat author tag derived from the dedicated HMAC secret
- [x] A new participant's tag extends beyond four characters if its four-character prefix collides in that room
- [x] Participant responses and events do not expose usernames, email addresses, or raw account IDs
- [x] Messages show the profile-name snapshot, Chat author tag, server timestamp, and current Admin or Owner badge
- [x] A participant cannot edit or remove their own accepted Chat message
- [x] A successful submit response appears in the transcript
- [x] Reloading Chat returns the latest 100 visible entries from durable storage
- [x] The message endpoint returns success only after the database transaction commits
- [x] Rule tests cover normalization, grapheme limits, empty content, link rendering, and tag collision handling
- [x] SQLite integration tests cover migration, durable insert, active-account access, live-Channel access, and reload
- [x] A browser test proves that an active participant can send and reload one message

## Comments

- 2026-09-11: Implemented in `be2e2b3` (`feat: add durable chat messages`).
- Lint and type checking passed. Vitest passed with 226 tests. The webpack production build passed. The Chat browser send-and-reload test passed.
- The default Turbopack build could not bind an internal port in the execution environment. The webpack production build verified the application instead.
- The full Playwright run had 54 passes, 10 skips, and one unrelated failure. The committed desktop-frame snapshot still shows `v0.6.2`, while the parent and implementation commits use `v0.9.0`.
- The two-axis code review found no hard standards violations and no remaining specification findings.
- The implementation commit remains local because the full Playwright suite has the pre-existing screenshot failure.
