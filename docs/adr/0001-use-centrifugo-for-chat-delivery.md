# Use Centrifugo for Chat delivery

Chat needs long-lived client connections without coupling them to the Next.js process. Run one Centrifugo container on the current VM for authenticated connections and live event delivery. Browsers use five-minute connection tokens from Next.js, receive events from Centrifugo over WebSocket, and send messages or moderation commands to authenticated Next.js HTTP endpoints. Next.js grants server-side subscriptions to the visible Chat room and a participant-specific control channel. Browser clients cannot select channels or publish directly to Centrifugo.

Next.js remains the authority for account access, validation, rate limits, moderation, and seven-day history in SQLite. It accepts a message only after the database commits it, records an outbox event in the same transaction, and retries live delivery after a Centrifugo failure. Public transcript changes use an increasing room sequence. Private restriction changes use the control channel and do not appear in the room transcript. Each submission has a client idempotency key. Clients use these values to order messages, reconcile gaps, and deduplicate retries.

Use Centrifugo's single-node memory engine with up to 300 publications of stream recovery for 30 seconds. SQLite remains authoritative. If cache recovery fails or a room-sequence gap appears, the client reconciles from SQLite. Closed Chat interfaces do not hold Centrifugo connections. Disabling an account also disconnects its active Centrifugo clients. If Centrifugo is unavailable, Chat reports delayed delivery while playback and Channel status continue without it. Add Redis only if multiple realtime service instances become necessary.

Roll out Chat behind a disabled-by-default deployment flag. Enable it only after database migration, service health, and the live-stream capacity test pass. Disabling the flag restores the placeholder without deleting Chat data.

The flag applies to every live Channel. The first release has no per-Channel switch or room-specific policy. Every Chat room uses the same message, rate, retention, and moderation rules.

Centrifugo restarts must not reload or interrupt playback. Clients reconnect, refresh their token when necessary, and reconcile from their last room sequence. A Chat failure leaves the viewer health endpoint successful when core viewing still works, but the endpoint reports Chat as degraded. The Centrifugo container has its own health check. A sustained outage produces one Discord alert after five minutes and one recovery alert.

## Considered options

- Next.js with Redis would leave connection management in the application and add a broker that the current single-process deployment does not need.
- A complete chat platform would duplicate the existing account model and require another primary database.
- A custom chat service would require the project to build connection management that Centrifugo already provides.
