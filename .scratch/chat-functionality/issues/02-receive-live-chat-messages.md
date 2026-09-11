# 02: Receive live Chat messages

**What to build:** Let participants on the same live Channel receive each other's accepted Chat messages through Centrifugo without refreshing, while SQLite remains the durable authority.

**Blocked by:** 01: Send and reload a Chat message

**Status:** resolved

- [x] Production runs one exact, pinned, ARM64-compatible Centrifugo image in the existing Docker Compose stack
- [x] Caddy remains the only public entry point and proxies the protected WebSocket route without a new public host port
- [x] Centrifugo and author-tag secrets use the existing encrypted deployment-secret workflow
- [x] An authenticated Next.js endpoint issues five-minute Centrifugo connection tokens only to active accounts
- [x] A visible Chat receives server-side subscriptions for its room transcript and the participant's private control channel
- [x] A browser cannot select an arbitrary Centrifugo channel or publish directly to Centrifugo
- [x] Message submission continues through the authenticated Next.js HTTP endpoint
- [x] The Chat database commits each message and its outbox event in one transaction
- [x] An outbox dispatcher publishes committed events to Centrifugo and retries transient failures
- [x] An outbox Retry uses a stable Centrifugo publication idempotency key
- [x] Public transcript changes receive a per-room increasing sequence
- [x] Two active participants on one room see an accepted message in the same stable order without refreshing
- [x] Clients deduplicate the HTTP result, outbox Retry, and recovered Centrifugo publications
- [x] Centrifugo keeps at most 300 publications for 30 seconds with stream recovery
- [x] A brief disconnect recovers cached publications without a full page reload
- [x] A failed recovery or room-sequence gap reconciles missing transcript entries from SQLite
- [x] Reconnect refreshes an expired token and completes reconciliation within the agreed five-second target under healthy load
- [x] Closing or collapsing Chat closes its Centrifugo connection
- [x] Disabling an account disconnects all of that account's active Centrifugo clients and rejects token refresh
- [x] A Centrifugo restart does not reload the watch page or interrupt playback
- [x] Integration tests use a real pinned Centrifugo container to verify tokens, subscriptions, blocked direct publication, recovery, gap repair, reconnect, and account disconnect
- [x] A browser test proves live delivery between two authenticated participants

## Comments

- 2026-09-11: Implemented in `4b82d2a` (`feat: add live Chat delivery`). Review fixes are in `1583464` (`fix: close Chat access races`).
- The pinned Centrifugo 6.9.3 image manifest includes ARM64. Compose and Caddy validation passed. Caddy remains the only public entry point.
- Vitest passed with 242 tests. Lint, type checking, and the webpack production build passed. Real-container tests cover token replacement, fixed subscriptions, blocked browser actions, recovery, the 300-publication limit, and account disconnect.
- The Chat browser tests passed. They prove two-participant delivery, SQLite gap repair, reconnect within five seconds, page and video-element continuity across a Centrifugo restart, and test-container cleanup.
- The default Turbopack build could not bind an internal port in the execution environment. The webpack production build verified the application.
- The full Playwright run had 55 passes, 10 skips, and one unrelated failure. The existing shared desktop application-frame snapshot differs by 20 pixels because its saved version text is stale.
- Both requested GPT Luna Max review agents hit the account usage limit before they returned results. The completed local Standards and Spec reviews found two race defects: stale messages during Channel navigation and account disablement during an asynchronous live-status check. Both defects have regression tests and fixes in `1583464`.
- The commits remain local because the full Playwright suite has the pre-existing screenshot failure.
