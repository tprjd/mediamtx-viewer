# 03: Complete independent refreshes after file failures

**What to build:** After Stream key rotation, a failed profile write does not
prevent other retained profiles from receiving their valid credentials. The
Channel owner sees which updates are confirmed, which need inspection, and why
setup stopped before later profile changes or OBS launch.

**Blocked by:** 01: Centralize Managed OBS profile completion.

**Status:** resolved

Spec: [Deepen Managed OBS profile completion](../spec.md).

This ticket covers file failures through the completion operation, actual profile
files, and the displayed result. It can start after ticket 01 without waiting for
ticket 02.

## Acceptance criteria

- [x] When one credential write fails, attempt every remaining independent retained-profile refresh with valid settings. A failed RTMP write must not prevent later RTMP or retained WHIP updates.
- [x] Finish all retained credential attempts before WHIP creation or repair. Any refresh error makes completion fail overall and prevents that later work and OBS launch.
- [x] After a write exception, read the destination credential file and compare it with the intended settings in memory. Do not print credentials during comparison or reporting.
- [x] When replacement succeeded but cleanup failed, matching readback confirms the update and reports the cleanup failure. Cleanup failure still makes the overall operation fail.
- [x] If readback fails or finds different settings, report "update not confirmed". Do not claim that the previous key remains merely because a write threw.
- [x] Preserve the original operation error after readback. Preserve successful independent credential updates and the existing per-file replacement protections.
- [x] The displayed result identifies affected profiles and distinguishes confirmed updates from unconfirmed results. Results and captured logs contain no Stream key or credential-bearing URL.
- [x] Real PowerShell tests call the production completion operation with temporary profile files and controlled write, cleanup, and readback failures. Cover failures before replacement, after successful replacement, and during readback.
- [x] Tests prove that later profiles still update, overall failure reaches the caller, and WHIP creation or repair and OBS launch do not follow. Include a retained WHIP profile and retained RTMP profiles outside the current selection.
- [x] Tests use valid, consistent publishing settings so this slice is independently verifiable before validation changes. A skipped PowerShell test does not satisfy acceptance.
- [x] Preserve successful setup, normal reruns, repair and reset behavior when refresh succeeds, pilot disablement, missing-capability handling, backup exclusions, and PowerShell 5.1 compatibility.
- [x] Update the maintained Windows OBS guide with the implemented failure and recovery guidance. Run the relevant repository checks and follow the delivery workflow.

## Comments

- 2026-10-18: The user approved this ticket with ticket 01 as its only blocker. Native Windows file behavior and OBS publishing remain separate from proof under `pwsh`.
- 2026-10-18: Implementation started after tickets 01 and 02 were delivered. The user explicitly excluded the full Docker suite. Tests will exercise the approved completion operation with real profile files and controlled filesystem failures.

- 2026-10-18: Implemented independent credential refreshes, destination readback after write errors, original-error preservation, credential and URL redaction, and the gate before WHIP creation or repair and OBS launch. Updated the Windows OBS guide.
- 2026-10-18: Verification passed: 770 non-Docker tests in 80 files (34.86 seconds), including all 43 executable PowerShell profile cases; lint; typecheck; production build; PowerShell 5.1 syntax analysis; packaged script comparison; and diff checks. Standards and Spec reviews each reported zero findings. The full Docker suite was excluded as requested. Native Windows file behavior and OBS publishing were not tested.
- 2026-10-18: Delivered in commit `73f478f` (`fix(obs): finish credential refreshes after file errors`) and pushed to `origin/main`. Only the three task files were committed. Pre-existing workspace changes remain separate.
