# 09: Back up and restore Chat

**What to build:** Enforce seven-day Chat content retention and let an administrator back up or restore Chat without rolling back authentication or interrupting playback.

**Blocked by:** 03: Browse retained Chat history; 07: Manage Chat bans and moderation history

**Status:** ready-for-human

- [x] Retention cleanup deletes Chat messages after seven days
- [x] Retention cleanup deletes original removed content after seven days
- [x] Retention cleanup deletes private moderation notes after seven days
- [x] Retention cleanup keeps structured Chat moderation records until an administrator clears them
- [x] Cleanup runs on application startup and once per hour
- [x] Cleanup runs before every backup
- [x] Cleanup runs immediately after a Chat restore and before Chat becomes available
- [x] One daily job backs up the authentication and Chat databases into separate encrypted files
- [x] Both backup files share one backup identifier and manifest
- [x] The manifest records enough information to select and validate either database backup
- [x] Backup rotation retains seven complete daily sets
- [x] Rotation does not leave an unpaired backup file or manifest
- [x] An administrator can restore the Chat database without restoring the authentication database
- [x] An administrator can restore the authentication database without restoring the Chat database
- [x] A Chat-only restore validates internal account and Channel references through the application
- [x] Expired content cannot reappear after restoring an older Chat backup
- [x] Chat remains unavailable until restore validation and cleanup finish
- [x] Authentication and playback remain available during an independent Chat restore
- [x] Backup tests verify encryption, shared manifests, seven-set rotation, incomplete-set handling, and independent selection
- [x] A scripted restore test proves Chat-only restore, expiry purge, Centrifugo reconnect, and continued authentication and playback



## Implementation and verification

Implemented on 2026-09-16. The backup command now creates paired encrypted sets and a shared authenticated manifest. The application restores Chat independently, validates references, purges expired content, and reconnects clients. A failed restore keeps Chat unavailable. Missing or corrupt live Chat storage can be replaced from a valid set.

- All 332 Vitest tests pass, including retention, encryption, rotation, independent selection, failed restore, and missing or corrupt database recovery.
- The browser restore drill passes with real Centrifugo and the local video fixture. It checks Chat unavailability during a failed restore, expiry deletion, reconnect, an unchanged account session, and continued playback without reset.
- Lint and TypeScript checks pass.
- The production webpack build passes. The default Turbopack build cannot bind its worker port in this environment and fails with `Operation not permitted`.
- Astra at medium reasoning completed Standards and Spec reviews. Both follow-up reviews report no remaining blockers.

The daily systemd timer and installation procedure are included in `docs/chat-operations.md`. Install the timer and supply the backup key on the deployment host. No production deployment or live-stream capacity test was performed. Chat remains subject to the rollout gates in issue 10.
