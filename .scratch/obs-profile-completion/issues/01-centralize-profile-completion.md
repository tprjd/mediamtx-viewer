# 01: Centralize Managed OBS profile completion

**What to build:** A Channel owner can complete local OBS profile setup through
one operation that refreshes retained publishing credentials and completes the
WHIP profile. Existing setup behavior remains verifiable through the same
interface used by production.

**Blocked by:** None (can start immediately).

**Status:** resolved

Spec: [Deepen Managed OBS profile completion](../spec.md).

This prefactor preserves current failure behavior. Tickets 02 and 03 add the
approved changes to validation and file-failure handling.

## Acceptance criteria

- [x] One completion operation in the existing PowerShell script accepts the authorization response and existing setup context. Production and executable tests call that same operation.
- [x] The completion module owns retained-profile discovery, credential refresh, and WHIP completion order. Its caller no longer coordinates partial operations or handles the missing-output refresh branch itself.
- [x] The operation returns an overall outcome and per-profile results without credentials. The caller displays the result and proceeds only on success.
- [x] Successful setup refreshes every retained Managed OBS profile, including RTMP profiles excluded from the current selection and a WHIP profile retained after pilot disablement.
- [x] Existing missing-output and missing-encoder behavior remains: retained WHIP credentials refresh before the capability error when preceding credential writes succeed. Setup does not create an unusable new WHIP profile or launch OBS after failure.
- [x] Normal reruns preserve existing settings and unrelated profiles. Repair, reset, canvas selection, backup exclusions, pilot eligibility, and the Streaming contract retain their existing behavior.
- [x] Installation, browser authorization, server key rotation, earlier RTMP configuration work, scene changes, and OBS launch retain their current owners. The launcher still embeds one script without additional packaging.
- [x] Real PowerShell tests exercise the completion operation with temporary profile files. They cover successful completion, retained targets, capability failures, and settings preservation. A skipped test does not satisfy acceptance.
- [x] Existing authorization and launcher checks remain effective. Inspect the caller as well as test outcomes to verify that completion rules moved into the module.
- [x] PowerShell 5.1 compatibility remains required. Record native Windows verification separately from tests under `pwsh`.
- [x] Update the maintained Windows OBS guide to identify the completed ownership change. Run the relevant repository checks and follow the delivery workflow.

## Comments

- 2026-10-18: The user approved this ticket as the first of three. Tickets 02 and 03 are each blocked only by this ticket.
- 2026-10-18: The user requested implementation. Added the shared completion operation and migrated executable tests to that boundary. The first completion test failed because the operation did not exist, then passed after implementation.
- 2026-10-18: Focused verification passed all 13 profile and authorization tests under Node 24.15.0 and PowerShell 7.6.7. The six executable PowerShell cases did not skip. Lint, typechecking, the production webpack build, the Streaming contract check, and PSScriptAnalyzer's PowerShell 5.1 syntax rule passed. Native Windows PowerShell 5.1 and OBS publishing were not run. Full-suite verification is pending.
- 2026-10-18: Standards and Spec reviews found a canvas-source change and a launch-order change caused by separating selected profiles from the full managed list. Both were corrected and checked with real PowerShell. Both reviewers then reported zero remaining findings.
- 2026-10-18: Final non-Docker verification passed all 733 tests across 80 files in 23.45 seconds, including all six executable PowerShell cases. The full Vitest run was interrupted with SIGINT (exit 130) after the user objected to the prolonged Docker test run; it is not recorded as a pass. Lint, typechecking, build, Streaming contract validation, PowerShell 5.1 syntax compatibility, and both code reviews had already passed. Native Windows runtime and OBS publishing remain unverified. Removed the interrupted run’s 18 containers, 12 test volumes, three fixture image references, and two networks; Docker has no remaining containers.
- 2026-10-18: Delivered as commit `a69530e7e3a772d06e76da65f2f9d05ff7d53497` (`refactor(obs): centralize managed profile completion`) on `codex/whip-streaming`, pushed to its configured upstream `origin/main`. Verified the remote main commit matches. The pre-existing `next-env.d.ts` change and local planning files were excluded from the commit.
