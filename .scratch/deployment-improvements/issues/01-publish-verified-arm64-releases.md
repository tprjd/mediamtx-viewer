# 01: Publish verified ARM64 releases

**What to build:** Pushing an annotated release tag runs the normal verification sequence and publishes public Linux ARM64 viewer and thumbnailer images. The operator can identify the exact source and tested images for a release before selecting it for deployment.

**Blocked by:** None (can start immediately).

**Status:** resolved

Source: Verified releases and recoverable deployment spec. Covers user stories 1-10, 51, and 52.

- [x] An annotated release tag starts a workflow on standard GitHub-hosted Linux ARM64 runners. Keep the current public repository and avoid paid runners or new recurring services.
- [x] Build both application images from the tagged commit. Use committed source only and reject a tag version that differs from the application version. Keep the application version derived from package metadata.
- [x] Run lint, type checks, unit and integration tests, browser tests, the independent restore drill, production build checks, Streaming contract validation, Compose validation, and authenticated proxy checks. Tests use isolated services and test-only configuration.
- [x] Neither the live Chat load test nor the synthetic storage benchmark is a release requirement. Failure or unavailability of a required non-capacity check prevents release readiness.
- [x] Publish public images to GitHub Container Registry. A VM can pull both images anonymously. Verify Linux ARM64 output, including native dependencies, rather than inferring it from the runner label.
- [x] Publish a release record that binds the tag, commit, application version, both image digests, and completed verification evidence. Partly uploaded images or a failed workflow cannot appear as a ready release.
- [x] Source verification covers all inputs for both images and deployment configuration. Extend the existing fingerprint where necessary instead of treating its current input list as complete.
- [x] Deployment can resolve an immutable image digest from the release record. A rerun cannot silently substitute another build under an already published release identity.
- [x] Support refreshed verification of the same source and exact image digests without replacing a published image. Format-1 records retain the 24-hour expiry. Format-2 records retain evidence for their exact source, tag object, and image digests, with fresh deployment checks.
- [x] Keep production SSH access, SOPS decryption keys, backup keys, plaintext secrets, encrypted deployment-secret bundles, private configuration, and operator notes out of image contexts, layers, and public output. Use only the workflow permissions needed for publication.
- [x] Validate images and evidence with observable behavior. Exercise failure cases for incomplete checks, wrong architecture, mismatched version, and changed source. Inspect image layers and output for known fixture secrets.
- [x] Demonstrate a successful hosted ARM64 workflow and anonymous image pulls during implementation. Local workflow syntax validation alone is insufficient. Do not deploy to production as part of that validation.
- [x] Update release guidance to explain automatic builds and manual deployment. Preserve the existing release checks and annotated-tag conventions. Do not make the new deployment path the default in this ticket.

## Implementation notes, 2026-09-24

At the time of this review, implementation was present in the working tree and was not committed or pushed. See the later delivery update under Comments.
The hosted workflow and anonymous GHCR pulls have not run. This ticket is incomplete.

- Astra at medium reasoning reviewed Standards and Spec. No unresolved code findings remain.
- The workflow runs the full source checks on standard x64 Linux, then builds and tests final images on standard ARM64 Linux. Playwright's ARM64 Chromium reported no H.264 decoding support for the existing test media.
- Unit and integration tests pass, 480 total, including 23 release-command tests. Lint, type checks, the production build, the independent restore drill, Streaming contract validation, Compose validation, and authenticated proxy checks pass.
- Updated stale Linux visual baselines after inspecting all nine images. The old login baseline showed v0.9.0. Screenshot styles hide the version only during capture; separate assertions check its real value and superscript style.
- Required browser verification fails in the existing retained Chat history scenario. After closing and reopening Chat, it waits for an older-message response that does not arrive. Reproduced with the unchanged Chat test on the workstation. Experimental scroll-helper changes were not reliable and were reverted. No Chat application code changed.
- The repository delivery rule initially blocked committing or pushing while this required check failed. The user later authorized a new branch and push. Fix and rerun the Chat browser gate before hosted validation.

Failure log: `.data/deployment-improvements/mediamtx-retained-check.log`.
Linux verification log: `.data/deployment-improvements/mediamtx-x64-checks.log`.

## Comments

### Delivery update, 2026-09-24

The user authorized creating a new branch and pushing the implementation with the known browser-test failure.

- Branch: [feat/verified-arm64-releases](https://github.com/tprjd/mediamtx-viewer/tree/feat/verified-arm64-releases).
- Commit: [b850a34](https://github.com/tprjd/mediamtx-viewer/commit/b850a348c849692ff0ed83e2f1476d7648e7db4b).
- Push succeeded. The remote branch matches the local commit.
- Status remains `claimed`. The required Chat browser test still fails. A successful hosted workflow and anonymous GHCR pulls remain unverified.
- Issues 02 through 09 have not been implemented. Their status is unchanged.

The issue files and earlier planning changes remain local and were not included in this commit.

### 2026-09-25: Combined acceptance in progress

Hosted validation now runs on pushes to `feat/verified-arm64-releases` in validation mode. Commit `6bd8f13` added this branch trigger without creating releases or deploying Oracle. The first hosted run, https://github.com/tprjd/mediamtx-viewer/actions/runs/36174245242, exposed missing cached service images in the test fixture.

Commit `ebae1bc` fixes fresh-runner image setup and the Chat browser test's synthetic-scroll race. The original retained-history test and a new repeated-reopening test passed six runs without retries, with real wheel input. This verifies continued scrolling and retained reading position, not a guarantee that one immediate scroll during initial layout is never adjusted. Chat application code is unchanged. Lint, type checking, production build, and 42 focused tests passed. Hosted ARM64 verification and anonymous pulls remain pending on the new commit.

### 2026-09-25: Hosted failures isolated

Hosted run https://github.com/tprjd/mediamtx-viewer/actions/runs/36178142581 failed after 38 minutes 41 seconds: 556 tests passed and 13 failed. Eight failure reports included the host CPU/memory rejection. The ARM64 job was skipped.

Commit `3799692` gives isolated deployment fixtures deterministic healthy CPU/memory readings while retaining the explicit unhealthy cases. Production checks are unchanged. A real fixture probe passed healthy preparation and confirmed rejection for high CPU and low memory. The separate Chat cleanup test passed locally in 124 seconds. Lint and 23 release tests passed. Release tests now stop after failure to shorten diagnosis. The remaining Chat timeout and full hosted acceptance still require a successful run.

### 2026-09-30: Implementation and hosted acceptance complete

[Hosted run 36752925565](https://github.com/tprjd/mediamtx-viewer/actions/runs/36752925565) passed on `1518601`. All 17 source groups passed, including all 11 Docker suites. Both native ARM64 images passed layer inspection, runtime checks, and anonymous digest pulls. A second attempt reran the static group and retained the other 16 successful executions.

The final browser-fixture-only change, `9aa606b`, passed [all six branch groups](https://github.com/tprjd/mediamtx-viewer/actions/runs/36756829244). The browser suite passed 77 tests with nine configured skips and no retries. These results resolve the earlier hosted acceptance blockers. No release tag or production deployment was made during this work.

The user deferred further validation. This status update records existing results and does not start another test run.
