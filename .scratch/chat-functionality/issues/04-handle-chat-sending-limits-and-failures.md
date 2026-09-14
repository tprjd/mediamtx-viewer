# 04: Handle Chat sending limits and failures

**What to build:** Give a Chat participant clear and recoverable sending behavior during normal requests, rate limits, request failures, and Centrifugo outages.

**Blocked by:** 02: Receive live Chat messages

**Status:** resolved

- [x] The server limits one account in one room to five messages per ten seconds with a burst of three
- [x] The sending limit applies across all tabs and live connections for that account and room
- [x] A rate-limit response includes the time at which the participant can try again
- [x] The composer keeps rate-limited text, disables Send, and shows a visible countdown
- [x] Chat does not queue or automatically send a rate-limited message
- [x] Submitting creates an immediate optimistic entry with a Sending state
- [x] A successful response reconciles the optimistic entry with the durable server message
- [x] A failed request keeps the text and presents Retry
- [x] Retry reuses the original client idempotency key and cannot create a second durable message
- [x] During a Centrifugo outage, Next.js continues to accept durable messages
- [x] During a Centrifugo outage, Chat shows Reconnecting and marks affected optimistic entries as delayed
- [x] Recovery reconciles delayed entries and removes duplicate events
- [x] If the Chat database is unavailable, loaded messages remain visible and the composer becomes unavailable
- [x] Closing and reopening Chat on the same Channel keeps an unsent draft in memory
- [x] Page reload or Channel navigation clears the draft and no draft enters browser storage
- [x] An explicit Open Chat action focuses the composer, but initial page load does not
- [x] Closing Chat returns focus to the restore control
- [x] While the composer has focus, typing does not trigger player shortcuts
- [x] Enter sends only when input-method composition is inactive
- [x] Error, delayed, and rate-limit feedback is available to assistive technology without repeating the transcript
- [x] Rule and integration tests cover rate boundaries, multi-tab enforcement, idempotent Retry, durable acceptance during delivery failure, and database failure
- [x] Browser tests cover optimistic success, failed Retry, delayed delivery, countdown, drafts, focus, player shortcuts, and input-method composition

## Comments

- 2026-09-14: Implemented in `8774c24` (`feat: handle Chat sending limits and failures`).
- Added the shared account-and-room rate limiter, retry timestamps, optimistic sending, durable idempotency keys, outage recovery, draft retention, focus handling, keyboard shortcut isolation, and IME-safe Enter handling.
- Validation passed: 43 Vitest files with 262 tests, ESLint, TypeScript type checking, the webpack production build, and seven real Chat browser scenarios.
- Sol high Standards and Spec review found no documented standards violations. The review findings about healthy sends being marked delayed, same-Channel draft loss, and publication-before-response duplicates were fixed and covered by tests. The follow-up Sol review could not run because the reviewer reached its usage limit.
