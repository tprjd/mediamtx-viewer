# Release the application

Use Semantic Versioning for the application. The Streaming contract and OBS
setup script have independent versions.

## Select the version

- Patch: a fix that does not change user-facing behavior.
- Minor: a new feature that is backward compatible.
- Major: a breaking change to accounts, playback, or deployment.

Do not change the version for documentation or planning changes.

## Publish the release

1. Update the version in both `package.json` and `package-lock.json`.
2. Add a dated Keep a Changelog entry to `CHANGELOG.md`.
3. Run `npm run lint`, `npm run test:fast`, and `npm run build`. Run the focused verification groups for changed behavior and fix failures before tagging. The release workflow runs the complete test set, including all Docker groups, before publication. Do not repeat the entire Docker suite locally when the release workflow will run it.
4. Commit the release changes with a Conventional Commits message, such as `chore: release vX.Y.Z`.
5. Create the annotated tag with `git tag -a vX.Y.Z -m "Release vX.Y.Z"`.
6. Push the release commit and tag with `git push origin main vX.Y.Z`.
7. Wait for the **Verified ARM64 release** workflow to pass. Confirm that the GitHub release contains `release.json` and that both container images can be pulled anonymously.
8. Start **Deploy MediaMTX** in the private [deployment repository](https://github.com/tprjd/mediamtx-deployment), or follow the [workstation deployment procedure](../deploy/oracle/README.md). Adopt an existing installation once, then select its verified tag explicitly. Tag publication never activates Oracle.
9. Confirm that the header and `/api/health` show the release version.

`lib/app-version.ts` derives `APP_VERSION` from `package.json`. Keep that file
as the runtime version source.

## Verify public images

The release workflow runs all non-capacity rollout checks in independent jobs on
standard `ubuntu-24.04` x64 runners. Local and hosted commands use the same
verification groups. Playwright Chromium on Linux ARM64 cannot decode the
H.264 test media. After the checks pass, the standard `ubuntu-24.04-arm` runner
validates the source fingerprint and builds both Linux ARM64 images. It checks
their layers for excluded private files and starts both images. The
viewer must report the expected version and healthy core state.

Images are published under `ghcr.io/tprjd/mediamtx-viewer/viewer` and
`ghcr.io/tprjd/mediamtx-viewer/thumbnailer`. The release record contains exact
image digests, source identity, and verification evidence. An image tag alone
does not establish release readiness. A record is ready only after its exact workflow attempt completes successfully.
Run `GITHUB_REPOSITORY=tprjd/mediamtx-viewer node scripts/release-publication.mjs ready release.json`
to check this condition. Deployment must also validate the release record and current operational state.

GitHub can create a new package with private visibility. If the anonymous-pull
check fails, open each package's settings and set its visibility to **Public**.
Rerun the failed workflow after both packages are public. Use **Re-run all jobs**
if the previous checks are more than 24 hours old. Keep production keys
and configuration outside the image context and GitHub Actions.

To verify the workflow before cutting a release, run **Verified ARM64 release**
manually with mode `validation`. It builds and publishes test images and saves
verification evidence, but creates no deployable release or production deployment.

To refresh a legacy format-1 release's 24-hour verification evidence, run the workflow
with mode `refresh` and its tag. Select that same tag in the **Use workflow from**
field, so the workflow run identifies the release commit. It pulls and tests the recorded images without
rebuilding them. It appends a uniquely named verification asset and leaves the
original `release.json` unchanged. A moved tag or changed image identity fails.

New releases use record format 2. Their successful test evidence remains valid
for the exact commit, annotated tag object, source fingerprint, and image digests.
A delay before deployment does not require another full test run. This evidence
does not prove current host readiness or current vulnerability status.

Format-1 records retain the 24-hour rule. A refresh preserves the record format;
it does not convert old evidence to the new policy. Unknown formats, missing
records, invalid timestamps, failed or inaccessible workflow evidence, moved
tags, and changed identities are rejected. Creating or refreshing either format
still requires source checks completed within the previous 24 hours.

To revoke a release for future preparation and activation, change its GitHub
release to a draft or remove the published release. Both actions make selection
fail. Removing its evidence or exact workflow run also blocks selection. These
actions do not stop an already running deployment or invalidate a retained local
rollback record. Recovery remains subject to database compatibility and fresh
runtime checks.

Each deployment checks image availability and identity, resolved configuration,
host resources and disk space, database state, a verified maintenance backup,
and candidate runtime health. Durable test evidence cannot bypass these checks.

For local ARM64 image verification, run `node scripts/release-images.mjs`. This
builds temporary local images, checks the image layers, and starts the images
with test-only runtime configuration. It does not publish or deploy them.

For development, follow [Run verification](verification.md). Branch checks never
publish images. Release publication requires every group, regardless of branch
path filters. The collector checks each report against the latest job for that
group, its workflow run, commit, source fingerprint, and required commands.

Use **Re-run failed jobs** to retry a failed group without repeating successful
groups. Successful jobs from an earlier attempt keep their original report and
job identity. A newer failed or cancelled job cannot fall back to an older success.
GitHub may copy retained jobs into a new attempt with new job IDs. The collector
matches their unchanged execution and step timestamps to the original report.
If the required reports have expired or are older than 24 hours, rerun all jobs.
Reports remain available for seven days. The source-verification job summary
shows setup, check, and total job time for each group.

Docker acceptance has one job per test file, with at most six verification jobs
running at once. Staging scenarios reuse immutable fixture layers. Hosted setup
downloads SOPS 3.13.3 and checks its pinned SHA-256 before installation.

The ARM64 image job caches BuildKit layers separately for each image and
architecture. It can restore layers from an earlier source version; BuildKit
checks each build input before reuse. Cache hits still require layer inspection,
runtime health checks, publication, and anonymous digest pulls. A missing cache
causes a full build. Source verification reports include total runner time and
elapsed time across the selected jobs.

Publication and refresh runs do not cancel one another. A newer manual validation
of the same ref cancels an obsolete validation run. All jobs check out the event's
commit so a moving branch cannot change the source between jobs.

To stage a published release without activation, follow
[Prepare a selected release](deployment-preparation.md). Use
`sh deploy/oracle/deploy.sh prepare TARGET vX.Y.Z`, then inspect it with
`sh deploy/oracle/deploy.sh status TARGET`. Preparation keeps the current services running. Activate explicitly with
`sh deploy/oracle/deploy.sh TARGET vX.Y.Z`.
