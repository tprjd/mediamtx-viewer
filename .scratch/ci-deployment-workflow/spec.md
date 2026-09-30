# Faster verification and release delivery

Status: complete
Date: 2026-09-30

Run focused tests locally during development. Use GitHub to verify committed source and publish tested Linux ARM64 images. Keep production activation manual.

This plan changes how verification runs. It retains the deployment protections in the [deployment spec](../deployment-improvements/spec.md). Issue 06 implements the approved change to verification expiry with explicit record compatibility.

## Observed problems

- The [September 27 run](https://github.com/tprjd/mediamtx-viewer/actions/runs/36317998554) failed after about eight minutes. The retained Chat history test failed on its initial run and retry. The mobile Channel drawer test passed on retry. The image job did not run.
- The [September 25 run](https://github.com/tprjd/mediamtx-viewer/actions/runs/36182701081) took about 43 minutes. All 569 Vitest tests passed in 2,155 seconds. Browser tests then failed.
- `.github/workflows/release.yml` starts full release validation on each push to `feat/verified-arm64-releases`. Validation can publish test images after the checks pass.
- `scripts/verification-checks.mjs` puts all checks in a sequential command list. `npm test` includes real Docker deployment tests.
- Source verification and image publication share one concurrency group. New branch work cannot cancel an obsolete running validation.
- `scripts/release.mjs` and `scripts/stage-release-source.mjs` reject verification older than 24 hours. Refresh runs the source checks again.

The logs establish the failed assertion and measured duration. They do not establish the cause of the Chat failure or which Docker fixtures account for most test time.

## Proposed workflow

| Stage | Trigger | Required work | Result |
| --- | --- | --- | --- |
| Local development | Developer command | Focused tests, then relevant verification groups | Feedback before a push |
| Branch verification | Pull request, manual run, and a temporary current-feature-branch trigger | Static checks, fast tests, browser tests, and a production build in separate jobs | Source check results, without image publication |
| Deployment acceptance | Relevant pull request changes or explicit full validation | Docker backup, activation, migration, recovery, retention, and adoption checks | Deployment test results |
| Release verification | Annotated release tag or explicit full validation | Every required source check and deployment acceptance group, followed by ARM64 image checks | Verified images and release evidence |
| Production activation | Explicit deployment command | Exact image download, host checks, maintenance backup, migration, activation, and health checks | Selected release active or a recorded recovery state |

Branch and pull-request trigger rules must avoid duplicate runs for the same change. Automatic deployment-test selection is an optimization for development only. Full release verification always runs every required group.

Keep browser verification on x64 Linux initially. The current workflow documents an H.264 limitation in ARM64 Chromium. Keep final image build and runtime checks on native Linux ARM64.

## Implementation order

1. [Define verification groups and local commands](issues/01-define-verification-groups.md). Inventory the tests, separate fast tests from Docker tests, and measure each group.
2. [Repair browser verification locally](issues/02-repair-browser-verification.md). Reproduce the Chat failure and investigate the mobile retry. Use repeated targeted runs before full browser verification.
3. [Separate branch checks from release publication](issues/03-separate-branch-verification.md). Add independent jobs and cancel obsolete branch runs. Preserve full checks for releases.
4. [Aggregate release evidence from independent jobs](issues/04-aggregate-release-verification.md). Bind every result to the source and preserve safe reruns and release readiness.
5. [Reduce measured setup and Docker costs](issues/05-reduce-verification-cost.md). Improve the measured slowest work without reducing coverage. Verify the complete hosted process.
6. [Separate release evidence from deployment freshness](issues/06-separate-evidence-and-freshness.md). Make the proposed expiry policy explicit before implementation. This issue does not block issues 01 through 05.

Issues 01 and 02 can proceed independently. Issue 03 depends on both. Issue 04 depends on issue 03. Issue 05 follows issue 04.

## Design decisions

- Keep one definition of required verification groups for local commands and GitHub jobs. Do not maintain separate test lists that can drift.
- Preserve an aggregate command that runs the full test set. Introducing a fast command must not silently reduce the coverage of `npm test`.
- Do not accept a local success report as GitHub release evidence. Local runs support development. GitHub verifies the committed release.
- Keep release verification in `.github/workflows/release.yml`. The existing readiness check validates that exact workflow path.
- Initially, run all release checks again for the tagged commit. Reusing results across different workflow runs requires extra identity and provenance checks and is outside this first change.
- A failed required job prevents publication of a ready release. A skipped, missing, cancelled, or mismatched report is not a pass.
- Reuse dependency and build caches only to reduce work. A cache hit is never test evidence. Prevent concurrent jobs from sharing mutable databases, containers, ports, or build output.
- Keep failed browser traces, test summaries, and per-group durations long enough to investigate. Use seven days initially and keep public artifacts free of private configuration.
- Keep production backups, controlled migrations, rollback eligibility, image digest checks, and runtime health checks.
- Use standard GitHub-hosted runners. Do not add a paid runner service or run CI on the production VM.

## Completion criteria

- A developer can run the failing browser scenario without the full release checks.
- Fast verification does not start Docker deployment fixtures.
- The union of verification groups preserves the full required test set. Any intentional duplicate, such as the independent restore drill, is documented.
- A branch check never logs in to GHCR or publishes images. A newer branch run cancels obsolete branch verification.
- A failed browser job can be rerun without repeating successful deployment jobs. Evidence aggregation correctly handles successful jobs retained from an earlier run attempt.
- Full hosted verification passes. Both final ARM64 images pass runtime checks and anonymous pulls. Hosted validation does not activate production.
- Reports show setup time, each group duration, total elapsed time, and total runner time. Performance claims use these measurements.
- Provisional targets are five minutes for fast branch checks and ten minutes for browser checks, excluding queue time. Set the full-release target after measuring the separated Docker groups.

## Delivery boundaries

The initial planning phase did not authorize delivery actions. The user subsequently authorized implementation, commit, and push, followed by publication of the completed issue and spec records.

Existing changes in `components/chat-transcript.tsx`, `playwright.config.ts`, and `tests/e2e/chat.spec.ts` predate this plan. Review them during issue 02. Preserve their contents and keep unrelated local work out of implementation commits.

For implementation, follow the repository delivery rules. Run the relevant checks before each task commit and push. Complete hosted validation before reporting the workflow as working.

## Completion evidence

All six implementation issues are resolved. Changes are committed and pushed through 9aa606b. Full release validation and an actual retained-job rerun passed on 1518601 in run 36752925565. The final test-fixture-only commit 9aa606b passed all six branch groups in run 36756829244. The redundant full manual run 36756858867 was cancelled. No release tag, version bump, or production deployment was made. Detailed measurements and test evidence are in the issue comments.

The user requested deletion of the temporary handoff and test map and commit of the completed records. Both temporary files were deleted. Further validation is deferred. This documentation commit uses `[skip ci]` to avoid starting another branch run.
