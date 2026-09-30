# 02: Create a verified maintenance backup

**What to build:** An operator can run a maintenance backup cycle against the current installation. The command stops application writers, creates an encrypted backup of both databases, verifies a copy on the workstation, and resumes the same release after health checks.

**Blocked by:** None (can start immediately).

**Status:** resolved

Source: Verified releases and recoverable deployment spec. Covers user stories 14, 15, 17-25, 33, 47-49, 51, and 52.

- [x] Provide a complete command-level backup cycle using the existing installation and existing backup encryption format. This ticket must work independently of GitHub release publication.
- [x] Check required keys, host and workstation space, database integrity, and recoverability of the running services before entering maintenance. Measure required temporary snapshot and encrypted-copy space, not only final backup size.
- [x] Show a static maintenance response that does not depend on the viewer. Stop or drain public application requests, persistent connections that can submit writes, and background database writers before taking snapshots.
- [x] Coordinate the operation with scheduled backups and explicit restores. Use an exclusive operation lock and a durable maintenance marker so that overlap or an unresolved failure cannot silently reopen writes.
- [x] Take a stable pair of authentication and Chat snapshots. Deployment backup must not purge or otherwise mutate live database contents. Apply required expiry cleanup to snapshots and preserve existing restore-time Chat retention rules.
- [x] Reuse authenticated manifests, encrypted database files, checksum checks, and integrity validation. Run backup tools with an explicit command that cannot trigger application startup migrations.
- [x] Store deployment sets separately from daily backup rotation. A second daily backup must not remove the set for this maintenance operation. Keep the existing seven-day scheduled policy intact.
- [x] Copy both encrypted databases and their manifest to private workstation storage. Verify checksums, authenticated decryption, integrity, and migration records before acknowledging a complete workstation copy.
- [x] Keep encryption keys separate from backups. Restrict and remove temporary plaintext verification files. Operational output must not contain secrets, private configuration, or application data.
- [x] A missing key, failed snapshot, corrupt backup, interrupted transfer, or insufficient space produces failure and never permits a subsequent migration or activation.
- [x] After a successful backup cycle, restart the same release with its original Chat state and verify health before ending maintenance. After a controlled failure, resume only if the unchanged previous state is known and healthy. Otherwise retain maintenance and report the repair action.
- [x] Expose the verified backup result for a later deployment to consume while writers remain stopped. The standalone command resumes the same release; activation can reuse the same completed backup phase without reopening user writes between backup and migration.
- [x] Test through the command against an isolated Docker host with real SQLite databases and encryption. Verify stopped writers, backup contents, workstation validation, unchanged live data, both Chat states, overlap rejection, and controlled failure behavior.
- [x] Extend existing backup and restore tests rather than adding a parallel format or test runner. Update backup and maintenance guidance. Full disconnect and host-restart reconciliation belongs to ticket 06.


## Implementation result

Implemented the standalone maintenance backup command and its held backup phase.
See `docs/maintenance-backups.md` for commands, recovery limits, and key handling.
The command preserves the current containers and effective Chat state. It uses
the existing encrypted backup format and keeps deployment sets outside daily rotation.

Verification passed on 24 September 2026:

- Lint, type checking, and the production build.
- Full Vitest suite with Node 22.22.2 and two workers: 58 files and 491 tests.
- Command tests with local Docker, real SQLite files, and encryption.
- Standards and spec reviews, including a corrected proxy recovery check.

The default Node 22.11 run could not load the installed jsdom dependency and
had timeout failures. The supported runtime rerun passed. Host-restart and full
disconnect reconciliation remain in ticket 06. Deployment-set cleanup remains
in ticket 08.
