# 02: Handle invalid and conflicting publishing settings

**What to build:** A Channel owner still receives valid credential updates when
settings for one publishing format are malformed. Conflicting Channel or Stream
key information stops completion before writes, and setup explains the failure
without exposing credentials.

**Blocked by:** 01: Centralize Managed OBS profile completion.

**Status:** resolved

Spec: [Deepen Managed OBS profile completion](../spec.md).

This ticket covers validation through the completion operation, profile files,
and the displayed result. It can start after ticket 01 without waiting for ticket 03.

## Acceptance criteria

- [x] Validate RTMP and WHIP settings separately inside the completion module. Preserve the existing checks for accepted URLs and credentials.
- [x] Malformed RTMP settings prevent RTMP writes but still permit independent valid WHIP credential refreshes. Malformed WHIP settings likewise permit independent valid RTMP credential refreshes.
- [x] Before any completion writes, check that otherwise valid response settings agree about the Channel, server hostname, and Stream key. A conflict rejects the entire response without credential changes or WHIP creation or repair.
- [x] Consistent RTMP and WHIP settings remain accepted despite their different transport URL forms. Normal valid setup retains its existing behavior.
- [x] Any validation failure makes completion fail overall, even when valid-format refreshes succeed. Later WHIP creation or repair and OBS launch do not occur.
- [x] The displayed result identifies rejected settings and completed refreshes without exposing a Stream key or credential-bearing URL. Successful independent updates remain in place.
- [x] Real PowerShell tests call the production completion operation with temporary profiles. Cover malformed settings in either format, both formats rejected, consistent settings, and separate Channel, hostname, and Stream key conflicts.
- [x] Tests inspect resulting files and the reported outcome. Conflict cases prove that completion made no writes. Malformed-format cases prove that the other valid format still refreshed.
- [x] Tests use writable profile targets so this slice is independently verifiable before file-failure handling changes. A skipped PowerShell test does not satisfy acceptance.
- [x] Preserve PowerShell 5.1 compatibility, retained-profile rules, backups, settings preservation, and the existing setup response format.
- [x] Update the maintained Windows OBS guide with the implemented validation behavior. Run the relevant repository checks and follow the delivery workflow.

## Comments

- 2026-10-18: The user approved this ticket with ticket 01 as its only blocker. Native Windows publishing remains separate pilot work.
- 2026-10-18: Implementation started after ticket 01 was delivered. The user explicitly excluded the full Docker suite. Verification will use real PowerShell completion tests, the non-Docker suite, and relevant static/build checks.
- 2026-10-18: Added independent RTMP/WHIP validation and conflict checks before writes. Failing executable completion tests preceded the implementation. The Spec review found that the separate response `streamKey` also needs comparison; three new failing cases proved that gap before the fix. All 34 focused tests now pass, including 27 real PowerShell cases. No Docker tests were run.
- 2026-10-18: Final verification passed all 754 non-Docker tests across 80 files in 29.35 seconds with all 27 executable PowerShell cases running. Lint, typechecking, production webpack build, and PowerShell 5.1 syntax compatibility passed. The packaged PowerShell script matches the source. Standards review: zero findings. Spec review: zero remaining findings after the response-key correction. The full Docker suite was excluded at the user’s request; native Windows PowerShell 5.1 and OBS publishing were not run. Ticket 03 retains file-error continuation and readback.
- 2026-10-18: Delivered as commit `d2cbd1539ddcf508526ab34c6d13160ba12610b8` (`fix(obs): validate profile completion settings`) on `codex/whip-streaming`, pushed to its configured upstream `origin/main`. Verified the remote commit matches. Pre-existing `next-env.d.ts` changes and local planning files remain outside the commit.
