# Deepen Managed OBS profile completion

Status: resolved

All eight design decisions below were accepted during the interview. The user
approved the three implementation tickets. All three tickets are implemented.

## Problem

The server rotates the Stream key before the OBS setup script receives it.
The script must then refresh every retained Managed OBS profile, including profiles
excluded from the current selection and a WHIP profile retained after pilot disablement.

The caller currently discovers RTMP targets, writes their credentials, and then
calls WHIP profile completion. One RTMP write error stops the remaining writes.
Later profiles can therefore retain the revoked key. The caller also has a special
branch that refreshes retained WHIP credentials before it reports missing WHIP output.

The existing PowerShell test calls individual helpers. It does not exercise this
complete caller sequence. Completion rules need one owner and one test interface.

## Scope and module ownership

One completion operation remains in
[`setup-frankerzspam-obs.ps1`](../../scripts/windows/setup-frankerzspam-obs.ps1).
It owns local profile work after an OBS setup session returns its Stream key.
Its interface accepts the authorization response and existing setup context.
The implementation owns profile discovery, credential refresh, and WHIP profile
completion order. It returns the overall outcome and per-profile results without
credentials. The caller displays the result and proceeds only on success.

Production and tests call this same operation. No additional script packaging or
generic adapter framework is required. This gives the module depth by removing
completion rules from its caller. Locality improves because those rules have one
implementation. Tests gain leverage by crossing the same seam as production.

Installation, browser authorization, server key rotation, scene changes, and OBS
launch retain their current owners. RTMP profile creation and repair remain in the
existing flow before authorization. Preserve existing settings, canvas selection,
pilot eligibility, backup exclusions, and the Streaming contract.

## Accepted behavior

### Validate formats and reject conflicting identities

RTMP and WHIP settings are validated separately. If one format fails validation,
completion rejects those settings but still attempts independent writes for the
valid format. The validation failure makes the operation fail overall.

Before any writes, completion checks that otherwise valid settings agree about
the Channel, server hostname, and Stream key. Conflicting settings reject the
entire response without changing any profile. This differs from malformed
settings for one format, where the other format can still proceed.

### Attempt all independent credential writes

After one profile write fails, completion still attempts the remaining independent
credential writes with validated settings. The server has already revoked the
previous Stream key. Stopping at the first file error would leave more retained
profiles with that revoked key.

Completion attempts every retained profile's valid credential refresh before it
creates or repairs the WHIP profile. Any credential refresh error blocks that
later work and OBS launch. This includes cleanup errors after a successful file
replacement. Existing capability failures still permit retained credential
refresh before setup reports the capability error.

### Report confirmed and uncertain outcomes

Any incomplete credential refresh makes the operation fail overall. The result
identifies confirmed updates and profiles that need inspection, without exposing
the Stream key. A write exception does not prove that the old file remains:
replacement can succeed before cleanup fails.

After a write exception, completion reads the destination `service.json` and
compares it with the intended settings in memory. Matching settings permit the
result "updated, cleanup failed" when cleanup caused the error. An unreadable or
different file produces "update not confirmed". Readback never suppresses the
original operation error, and credentials never appear in the result or logs.

## Verification

Executable PowerShell tests use temporary profile files and controlled failures.
A skipped test does not satisfy acceptance. Tests call the real completion
operation rather than reconstruct its private steps. Existing launcher checks and
profile preservation checks remain.

| Case | Required result |
| --- | --- |
| Valid settings and writable profiles | All retained targets receive the intended credentials. Normal WHIP completion can proceed. |
| One retained profile write fails | Remaining independent credential writes are attempted. The overall result is failure. |
| One format has malformed settings | Those settings are rejected. Independent valid writes still run. The overall result is failure. |
| Otherwise valid settings conflict | No profile changes. The entire response is rejected. |
| A credential refresh reports an error | WHIP creation or repair and OBS launch do not follow. |
| Replacement succeeds but cleanup fails | Readback confirms the destination. The result reports the update and cleanup failure. The overall result is failure. |
| Readback fails or finds different settings | The result reports that the update is not confirmed. The original error remains. |
| The pilot is disabled or the RTMP selection is narrowed | Every retained Managed OBS profile still receives its valid credential refresh. |
| WHIP output or the required encoder is unavailable | Retained credential refresh precedes the capability error. No unusable new WHIP profile is created. |
| Normal rerun, repair, or reset | Existing preservation, backup, and managed-default behavior remains. Credential refresh failures prevent later WHIP changes. |
| Results and logs from any case | No Stream key is exposed. |

PowerShell 5.1 compatibility remains required. Tests under `pwsh` alone do not
prove native Windows behavior. Native Windows OBS publishing remains a separate
pilot check, including the existing checks after Stream key rotation.

Inspect the final caller to confirm it no longer discovers credential targets or
coordinates partial completion steps. Apply the repository's relevant verification
and delivery checks during implementation.

## Files involved

- [OBS setup script](../../scripts/windows/setup-frankerzspam-obs.ps1): completion implementation and its caller.
- [Executable profile tests](../../lib/obs-profile.integration.test.ts): completion outcomes and failure cases.
- [OBS setup integration tests](../../lib/obs-setup.integration.test.ts): retain authorization and launcher checks.
- [Launcher packaging](../../lib/obs-setup-script.ts): verify the existing single-script packaging remains valid.
- [Windows OBS guide](../../scripts/windows/README.md): document actual behavior when the implementation is complete.

## Outside scope

- Installation, browser authorization, server key rotation, and the OBS setup response format.
- Scene changes, unrelated OBS profiles, and OBS launch behavior beyond stopping on completion failure.
- Playback, HLS conversion, other architecture candidates, and new publishing formats.
- A new script package, general command framework, or generic filesystem adapter.
- A release, deployment, version bump, or a claim that native Windows publishing is verified.

## References

- [Domain language](../../CONTEXT.md).
- [Local issue-tracker convention](../../docs/agents/issue-tracker.md).
- [Existing Managed OBS profile pilot work](../stream-resilience/issues/05-managed-whip-profile.md).
- [Verification guide](../../docs/verification.md).

## Comments

- 2026-10-18: The user accepted narrow completion scope, continued independent writes, separate format validation, blocked repair after refresh errors, readback after write errors, rejection of conflicting identities, one operation in the existing script, and required executable PowerShell tests.
- 2026-10-18: Moved the design from the Windows OBS guide into this specification. The guide retains its description of current behavior.
- 2026-10-18: The user approved ticket creation, then requested implementation of ticket 01. Final design confirmation is no longer pending.

- 2026-10-18: All three implementation tickets are resolved. Completion now owns retained-profile refreshes, validates publishing settings, continues independent writes after file failures, and reports confirmed and unconfirmed updates. The non-Docker suite, build, lint, typecheck, and PowerShell 5.1 syntax analysis pass. The user excluded the full Docker suite for tickets 02 and 03. Native Windows OBS publishing remains a separate pilot check.
