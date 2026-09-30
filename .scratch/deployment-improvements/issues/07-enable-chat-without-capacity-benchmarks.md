# 07: Enable Chat without capacity benchmarks

**What to build:** The operator can explicitly enable, disable, and inspect Chat using verified release evidence and normal health safeguards. Routine deployment and Chat enable no longer require a live capacity test or a synthetic storage benchmark.

**Blocked by:** 04: Deploy and roll back releases without migrations.

**Status:** resolved

Source: Verified releases and recoverable deployment spec. Covers user stories 37-42, 48, 49, 51, and 52.

- [x] Replace the capacity-report dependency in normal Chat enable with the selected release's successful non-capacity verification and current runtime checks. Do not delete the unrelated safeguards currently combined in the rollout gate.
- [x] Preserve source and exact-image matching, verification freshness, host architecture and resource checks, database integrity, broker health, application Chat health, and outbox checks.
- [x] Replace the synthetic storage report requirement with direct space checks while preserving runtime database and free-disk limits. Enabling Chat must not run the 700,000-message benchmark or require synthetic production participants.
- [x] Explicit enable checks its prerequisites, starts the required broker, applies the enabled state, and succeeds only after Chat is healthy. A failed enable retains the existing safe disabled outcome and reports failure.
- [x] Explicit disable stops the broker so cached tokens cannot keep connections open. Health distinguishes disabled, healthy, degraded, and unavailable states without treating core HTTP success as proof of healthy Chat.
- [x] Store and report the effective Chat state consistently with the managed deployment record. A later activation or eligible rollback preserves that state rather than reading a stale default from a secret file.
- [x] Coordinate Chat operations with the deployment lock and maintenance state. An explicit enable or disable must not race with activation, migration, or recovery.
- [x] Remove the normal flow's dependency on capacity trial timers. Cancel only the obsolete application-owned trial state that could disable Chat after activation. Preserve unrelated host timers and do not erase an active deployment recovery marker.
- [x] Optional capacity tools can remain available, but they do not gate standard deployment. Reports must continue to state that the capacity target is unverified; no bypass may fabricate a passing report.
- [x] Reuse Compose validation in both Chat states, authenticated WebSocket proxy tests, pinned-broker integration tests, and command-level deployment fixtures.
- [x] Test successful enable with no capacity reports, rejection by each retained safeguard, failed-enable cleanup, explicit disable, state preservation across activation, and an obsolete trial timer that cannot later disable the service.
- [x] Update Chat rollout and operational guidance to remove active mandatory-capacity instructions. Keep the historical record of the unverified capacity target and the distinction between planned maintenance and uninterrupted viewing.

## Comments

### 2026-09-25: Implementation complete

Implemented and pushed in commit `af4e9bb` on `feat/verified-arm64-releases`.

Managed Chat enable, disable, and health commands use verified release evidence and current runtime checks. Capacity benchmarks no longer gate these commands. The capacity target remains unverified.

Validation passed across 62 test files with 544 tests. The first run passed 235 tests, but Node 22.11 could not start 37 files. Those files passed with 309 tests on Node 22.23.3. Additional focused recovery and lock tests passed. Lint, type checking, the production build, Compose validation, and authenticated WebSocket proxy validation passed. Standards and specification reviews found no remaining issues.

The release verification timeout is now 90 minutes because the local Docker test suite took more than 60 minutes. Hosted CI results were not checked. No production deployment was performed.
