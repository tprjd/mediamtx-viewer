# 04: Deploy and roll back releases without migrations

**What to build:** One operator command stages a verified release, enters maintenance, verifies the off-host backup, activates the release, and restores normal access. If activation fails without database changes, it restores the exact previous runtime state. This first activation path accepts only releases that need no migrations.

**Blocked by:** 02: Create a verified maintenance backup; 03: Stage a selected release safely.

**Status:** resolved

Source: Verified releases and recoverable deployment spec. Covers user stories 11-20, 24, 28-33, 37-41, 43, 48, 49, 51, and 52.

- [x] Join the staging and maintenance-backup capabilities into a single opt-in deployment command. Maintain a host-side attempt identifier, exclusive lock, and durable phase record before actions that affect live state.
- [x] Use a known managed baseline for this slice. Full adoption of an existing unmanaged installation is ticket 09. Do not claim that an unverified installation is a successful managed release.
- [x] Record the previous release's exact service image identities, resolved deployment model, mounted configuration and scripts, required private secrets, effective Chat flag, and persistent-volume ownership before activation.
- [x] Determine migration requirements from actual applied records in both databases and the selected release. Reject pending migrations, altered history, or uncertain database state before activation. Ticket 05 adds controlled migration support.
- [x] Keep writers stopped from the maintenance backup boundary through activation. Require successful verification and acknowledgement of the encrypted workstation copy before changing the active release.
- [x] Prevent candidate and rollback container startup from running implicit migrations. Do not rely on a container restart policy to retry a failed deployment step.
- [x] Activate the downloaded image digests and staged files. Explicitly reload or recreate affected services so mounted-file changes take effect. Preserve the Compose project and application volumes, and avoid restarting unchanged services where possible.
- [x] Read the effective Chat state from the previous runtime and preserve it. Enabled Chat requires its broker; disabled Chat stays disabled and must not reopen broker connections. Do not force Chat off as part of normal deployment.
- [x] Complete deployment only after checking the selected application version, image identity, core health, required service health, database integrity, public proxy behavior, and expected Chat state. Enabled Chat requires healthy status and a drained delivery queue within a bounded wait.
- [x] The activation path does not request capacity or synthetic storage reports. Retain non-capacity verification and runtime storage limits. A core HTTP success with degraded enabled Chat fails deployment.
- [x] If activation fails, stop the candidate and recheck database migration state. Automatically restore the previous images, configuration, mounted files, and Chat flag only when both databases remain known and unchanged by migrations.
- [x] Automatic recovery never replaces or restores either database. Verify the restored release before ending maintenance. If recovery fails or state is uncertain, leave maintenance active and expose the failure phase and required next action.
- [x] A failed forward deployment returns a nonzero status even when rollback succeeds. Distinguish successful activation, failed deployment with successful rollback, and maintenance requiring recovery.
- [x] Test successful activation in both Chat states, wrong version, unhealthy services, degraded enabled Chat, controlled activation failure, exact configuration rollback, failed rollback, and preservation of database contents through the real command boundary.
- [x] Use isolated Docker fixtures and reuse the backup, proxy, and health test patterns. Update the opt-in deployment guidance. Ticket 06 completes disconnect and reboot recovery; ticket 09 switches the default procedure.


## Comments

Implemented the opt-in managed deployment command with verified staging, acknowledged encrypted backup, private acceptance, exact runtime rollback, and durable recovery status. The command rejects unmanaged baselines, pending migrations, changed migration history, and credential rotation. Automatic rollback preserves both databases and stops when volume ownership changes.

Verification: lint, type checks, production build, and all 510 tests in 60 files passed. The full test run used Node 22.22.2. Real Docker fixtures cover both Chat states, activation failures, exact configuration rollback, retained maintenance, database preservation, and fresh MediaMTX health after publishing ports. GPT-6 Sol xhigh Standards and Spec reviews have no remaining findings.
