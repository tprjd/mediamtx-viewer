# 02: Repair browser verification locally

Status: resolved
Blocked by: none

Source: [workflow plan](../spec.md).

Reproduce the retained Chat history failure with the smallest existing test command. The hosted failure occurs after reopening Chat, when `data-at-bottom` remains `false`. Investigate the mobile Channel drawer retry separately.

- [x] Inspect the pre-existing changes in the Chat component, Playwright configuration, and Chat tests. Do not overwrite or assume correctness of those changes.
- [x] Read `CONTEXT.md` and relevant installed Next.js guides before application edits. Follow the playback and Streaming contract rules if the fix enters those areas.
- [x] Run the retained-history test alone with `CI=1` and the same worker count as hosted verification. Capture the observed assertion and trace.
- [x] If macOS does not reproduce it, run the same scenario in matching x64 Linux conditions. Check the browser version and H.264 support. Do not use an ARM64 browser result as equivalent evidence.
- [x] Fix the demonstrated application or fixture problem. Do not remove assertions, increase retries, or replace failures with skips to obtain a pass.
- [x] Test the mobile Channel drawer independently and correct the demonstrated cause of its retry.
- [x] Verify that browser fixtures direct media requests to the intended test server. Investigate the hosted requests to the unavailable `127.0.0.1:8888` endpoint without assuming they caused the Chat assertion.
- [x] Pass ten consecutive targeted runs without retries in the relevant environment, then run the complete browser suite. Retain assertions for reading position and reopening behavior.

Likely files: `components/chat-transcript.tsx`, `tests/e2e/chat.spec.ts`, `tests/e2e/viewer.spec.ts`, and `playwright.config.ts`.

Completion requires observed behavior. A local type check alone does not establish that the browser failure is fixed.


## Comments

Implemented and pushed in f512122 and 013abb9. The old component reproduced the Linux layout-gap failure. The corrected Chat scenario passed ten repeats without retries; Channel drawer checks passed ten repeats on both browser projects. The full x64 Linux suite passed 77 tests with 10 configured skips in 7.6 minutes. Existing Chat edits were reviewed and retained. Tests now provide real reader input and valid virtual-list geometry.

Hosted validation 36741771175 exposed one mobile drawer retry after the earlier repeat runs. Reopened while tracing navigation completion. Browser retries will be disabled and first-failure traces retained.

Further zero-retry checks exposed shared-state and timing problems. The administrator scenario now runs after both viewer projects and waits for a new save result. Browser fixtures use one production standalone build with separate databases, removing runtime page compilation. The rate-limit scenario prepares its second tab before consuming the allowance. Commit 1f44be4 passes the full x64 Linux browser suite with zero retries: 77 passed, 9 configured skips (the duplicated administrator skip was removed when the test moved). Three more administrator repetitions and three rate-limit repetitions passed. Final hosted run 36747354972 is pending.

Hosted run 36747354972 and its branch run exposed two submission tests typing while the control subscription refreshed access. The trace showed an empty disabled input and no POST. Commit f7ad79d waits for connection and enabled input, then verifies the entered value. Both affected scenarios passed ten repetitions each on x64 Linux with zero retries (20 passed, 2.5 minutes). Lint and type checks passed. Full hosted validation of this commit is pending.

Final branch run [36749241646](https://github.com/tprjd/mediamtx-viewer/actions/runs/36749241646) passed on f7ad79d. It selected six groups and no Docker acceptance or publication jobs for the browser-only change. The release browser job in run 36749262145 independently passed 77 tests with nine configured skips, zero retries, in 5.1 minutes.

Branch run 36752895331 exposed a touch-tooltip failure while the release browser run on the same 1518601 source passed. A local repeat reproduced it after supplying the missing mobile HLS fixture. Event tracing showed the badge gaining focus, the tooltip opening, and a smooth page scroll from y=256 to y=72 immediately closing it. Preventing touch focus did not stop the scroll, so that component change was removed. Playwright retries an unstable tap with scrollIntoView({block: end}); the page applies smooth scrolling after the tap, which correctly dismisses the Radix tooltip. The test now completes target positioning with an instant scroll before tapping. It also waits for initial Chat readiness, gives each fresh mobile context its own HLS fixture, and asserts playback continuity. Repeated verification is in progress.

Commit 9aa606b completes touch target positioning before tapping and restores missing playback fixtures in both mobile contexts. No badge component change remains. Both mobile scenarios passed ten repetitions each on x64 Linux with zero retries (20 passed in 6.2 minutes). Lint and type checks passed. Final hosted validation is pending.

Final branch verification [36756829244](https://github.com/tprjd/mediamtx-viewer/actions/runs/36756829244) passed on 9aa606b: all six groups and the Branch checks result succeeded. Browser retries remain disabled. The browser job finished in 6 minutes 10 seconds, including setup. The complete branch job span was 6 minutes 28 seconds. The full release workflow and actual retained-job rerun had already passed on 1518601; 9aa606b changes only browser fixtures. Redundant manual full validation 36756858867 was cancelled instead of repeating deployment suites.
