# 10: Prove capacity and enable guarded rollout

**What to build:** Prove the complete Chat path on the current VM with a real live Channel, then make the global flag safe to enable or disable without a schema rollback.

**Blocked by:** 08: Degrade Chat without harming viewing; 09: Back up and restore Chat

**Status:** ready-for-human

- [x] The selected Centrifugo image is pinned to the exact ARM64 version that passes integration and deployment checks
- [x] The production Compose configuration validates with Chat both disabled and enabled
- [x] Chat remains disabled by default after deployment
- [x] Enabling Chat replaces the placeholder for every live Channel without changing offline or unavailable watch states
- [x] Disabling Chat restores the placeholder, closes Chat connections, and keeps Chat data and schema intact
- [x] A repository-owned load driver opens 100 authenticated Chat connections
- [ ] The load driver submits ten accepted messages per second for 15 minutes — Original capacity requirement waived by the owner for this deployment; see evidence.
- [x] The load run uses a real live Channel and one real playback browser
- [ ] Message submission p95 is at or below 500 milliseconds — Original capacity requirement waived by the owner for this deployment; see evidence.
- [ ] Live delivery p95 is at or below 1 second — Original capacity requirement waived by the owner for this deployment; see evidence.
- [ ] A 100-message history page p95 is at or below 1 second — Original capacity requirement waived by the owner for this deployment; see evidence.
- [ ] Reconnect and room-sequence reconciliation complete within 5 seconds — Original capacity requirement waived by the owner for this deployment; see evidence.
- [x] The playback browser has no Chat-induced playback recovery or protocol fallback during the run
- [x] Channel status updates keep their existing timing during the run
- [x] The viewer, Centrifugo, SQLite, and host return to healthy steady state after load stops
- [ ] The run records CPU, memory, free disk, Chat database size, outbox depth, request latency, delivery latency, reconnect time, Channel status timing, and playback behavior — Original capacity requirement waived by the owner for this deployment; see evidence.
- [x] The measured host has enough headroom for the Centrifugo container before Chat is enabled
- [x] A normal-volume check confirms that the seven-day database and seven backup sets fit the agreed 100,000-message daily storage budget
- [x] The independent Chat restore drill passes before enablement
- [x] The full lint, type, test, browser, production-build, streaming-contract, and deployment-configuration checks pass
- [x] The rollout instructions state the exact enable, health-check, rollback, and recovery actions
- [ ] Chat is not enabled if any latency, playback, restore, health, disk, or configuration gate fails — Original capacity requirement waived by the owner for this deployment; see evidence.

## Comments

Implemented the driver, strict automated gates, safe default, flag polling, deployment synchronization, proxy fixes, rollback procedure, and temporary-account cleanup.

The owner stopped further load testing and accepted the partial run on 2026-09-16. The original 15-minute performance target is not proven. The report remains failed; the standard enable gate remains strict. Chat was enabled as a documented operator exception after the remaining verification and health checks passed. No further load messages were sent.

The partial run opened 100 authenticated connections and accepted 2,009 messages. It recorded no playback interruptions or recovery in 205 observations. Rollback preserved messages and schema and closed sockets. Environment-flag changes recreate the viewer and can interrupt playback during deployment; the stronger live player-continuity assertion did not pass.

See [the measurements, checks, exception, and deployment limitation](../../../docs/chat-capacity/2026-09-16/README.md). Astra medium standards and specification reviews found no remaining code blockers.

The owner subsequently requested removal of test messages. All 2,009 test messages and broker cached copies were removed, all 100 accounts remain disabled, and their sessions are gone. The final backup contains the cleaned Chat database.
