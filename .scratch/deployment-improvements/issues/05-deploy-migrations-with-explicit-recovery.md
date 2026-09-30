# 05: Deploy migrations with explicit recovery

**What to build:** The deployment command can activate releases that require database migrations. It detects partial migration success and keeps the application in maintenance when automatic rollback is unsafe. The operator can inspect the failure and select an explicit recovery action.

**Blocked by:** 04: Deploy and roll back releases without migrations.

**Status:** resolved

Source: Verified releases and recoverable deployment spec. Covers user stories 21, 26-33, 36, 48, 49, 51, and 52.

- [x] Extend the established command path with explicit authentication and Chat migration phases after the verified backup and workstation acknowledgement. Keep user writes blocked throughout migration and acceptance checks.
- [x] Run migration commands once under the deployment owner. Prevent application entrypoints and container restart policies from independently retrying migrations during activation or rollback.
- [x] A failed Chat migration fails deployment even when ordinary application startup previously allowed an optional Chat migration failure. Preserve ordinary runtime behavior outside the managed deployment path unless a change is required and tested.
- [x] Record actual applied migration history in both databases before migration. Stop all migration processes before inspecting post-attempt history, including after an error.
- [x] A newly committed migration in either database blocks automatic old-application rollback. Detect earlier committed files when a later file fails and authentication success followed by Chat failure.
- [x] A failure before any migration commits can use automatic rollback only when both database states are unchanged and known. New migration filenames alone do not establish what happened.
- [x] Unreadable records, changed existing history, missing databases, or uncertain process completion leave maintenance active. Never rewrite migration history to make a failed attempt appear eligible for rollback.
- [x] Successful migrations proceed to the existing activation and health checks. Failure after a committed migration does not silently restore the previous application or either database.
- [x] Status reports the failed phase, observed migration changes, candidate and previous releases, and verified backup locations without private data.
- [x] Provide an explicit recovery operation usable during maintenance. Database replacement requires an explicit operator choice and explains possible loss of later data. Retrying deployment alone must not trigger a restore.
- [x] Reuse existing backup authentication, schema and reference compatibility checks, retained replaced files, and independent database restore protections. Restore only the databases explicitly selected. Preserve Chat expiry rules and keep maintenance if recovery validation fails.
- [x] Recovery does not require public application access. Any private application services needed for a restore must remain isolated from user writes until recovery health checks pass.
- [x] Real SQLite command-level tests cover successful migration, first-file failure before commit, partial sequence success, authentication-only success, Chat failure, unreadable migration state, and activation failure after migration.
- [x] Tests prove that automatic recovery never restores data, explicit restore preserves an unselected database, and unsafe states remain in maintenance. Extend the existing independent restore drill and integration tests where they already cover the behavior.
- [x] Update migration and recovery guidance. Do not introduce reverse migrations, a second encryption format, or a general claim that old application code supports newer schemas.

## Comments

Implemented and pushed in `81e5c18` on `feat/verified-arm64-releases`.

The deployment owner runs authentication and Chat migrations after the verified backup acknowledgement. New or uncertain migration records block automatic rollback. Explicit recovery selects the release and databases to restore, retains replaced files, and keeps maintenance active until acceptance passes.

Verification completed on 2026-09-25:

- All 520 tests passed across 60 files. The full run passed 211 tests in 23 files. Node 22.11 could not start 37 files because of an installed dependency's runtime requirement. Those files passed all 309 tests under supported Node 22.22.2.
- Build, typecheck, lint, and the independent Chat browser restore drill passed.
- Standards and spec reviews have no unresolved findings. The duplicated policy constant found in review now has one shared definition.

Migration and recovery commands are documented in `docs/managed-deployment.md`.
