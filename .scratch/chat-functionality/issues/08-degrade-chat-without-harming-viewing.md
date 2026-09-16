# 08: Degrade Chat without harming viewing

**What to build:** Keep viewing operational when Chat storage, Centrifugo, or host capacity is unhealthy, and give administrators one clear operational signal.

**Blocked by:** 04: Handle Chat sending limits and failures; 07: Manage Chat bans and moderation history

**Status:** ready-for-human

- [x] The main health response reports Chat as disabled, healthy, degraded, or unavailable
- [x] The main health response remains successful when core viewing works and only Chat is degraded
- [x] The Centrifugo container has an independent health check
- [x] A Centrifugo failure leaves playback, Channel status, loaded Chat history, and durable message submission available
- [x] A Chat database failure leaves playback and Channel status available
- [x] A Chat database failure keeps loaded messages visible and disables message and moderation commands
- [x] New Chat message submissions stop when the Chat database reaches 2 GiB
- [x] New Chat message submissions stop when the filesystem has less than 10 GiB free
- [x] Both disk thresholds are configurable
- [x] A disk threshold keeps retained history readable and leaves account access, Channel status, and playback operational
- [x] The Statistics page reports sustained Centrifugo failure, Chat database failure, outbox backlog, and disk-threshold state
- [x] One Discord alert fires after a Chat fault remains active for five minutes
- [x] Repeated checks do not send duplicate alerts for the same active fault
- [x] One recovery alert fires when the fault clears
- [x] Operational logs may contain event type, opaque identifiers, result, duration, queue depth, and error codes
- [x] Operational logs do not contain message content, profile names, private notes, tokens, cookies, or client idempotency keys
- [x] A Chat fault cannot change playback selection, playback runs, recovery eligibility, HLS timing, or WebRTC behavior
- [x] Health and alert tests cover state changes, the five-minute delay, deduplication, and recovery
- [x] Log-capture tests prove that participant content and secrets do not enter application or Centrifugo-facing logs
- [x] Browser tests prove that Chat failure states do not replace or interrupt the player



## Comments

### 2026-09-16: Implementation and manual verification

Implemented Chat health reporting, configurable storage limits, Statistics diagnostics, persistent Discord alert state, and startup isolation. Loaded messages stay visible during failures. The three focused browser tests verify that HLS playback continues through a Centrifugo outage, an unreadable Chat database, and the storage limit.

Verification passed:

- Lint and TypeScript checks.
- All 321 unit and integration tests.
- All three focused browser failure tests.
- The webpack production build and the normal Turbopack build in the production Docker image.
- Astra medium reviews for standards and spec compliance, with both findings resolved.

Manual verification remains open. The full Chat browser suite repeatedly failed in `browses retained Chat history without losing the reading position`. Failures included a missing scroll anchor, a 35-pixel anchor shift against the 12-pixel tolerance, and a timeout. The serial suite then skipped later tests. Supplying playable media did not fix that history test. Its implementation remains unchanged.

The user requested that repeated attempts stop and that this failure remain for manual testing. To check it, run:

```sh
npx playwright test --project=chat-chromium --grep 'browses retained' --headed
```

Then run the full Chat browser suite with `npx playwright test --project=chat-chromium`.

The host also denied Turbopack's internal port bind. The same build passed inside Docker. Browser startup on this host required a temporary connection-timeout helper outside the repository.
