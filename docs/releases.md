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
3. Run `npm run lint`, `npm test`, and `npm run build`. Fix failures before tagging.
4. Commit the release changes with a Conventional Commits message, such as `chore: release vX.Y.Z`.
5. Create the annotated tag with `git tag -a vX.Y.Z -m "Release vX.Y.Z"`.
6. Push the release commit and tag with `git push origin main vX.Y.Z`.
7. Wait for the **Verified ARM64 release** workflow to pass. Confirm that the GitHub release contains `release.json` and that both container images can be pulled anonymously.
8. Follow the [deployment procedure](../deploy/oracle/README.md). Adopt an existing installation once, then select its verified tag explicitly. Tag publication never activates Oracle.
9. Confirm that the header and `/api/health` show the release version.

`lib/app-version.ts` derives `APP_VERSION` from `package.json`. Keep that file
as the runtime version source.

## Verify public images

The release workflow runs all non-capacity rollout checks on the standard
`ubuntu-24.04` x64 runner. Playwright Chromium on Linux ARM64 cannot decode the
H.264 test media. After the checks pass, the standard `ubuntu-24.04-arm` runner
validates the source fingerprint and builds both Linux ARM64 images. It checks
their layers for excluded private files and starts both images. The
viewer must report the expected version and healthy core state.

Images are published under `ghcr.io/tprjd/mediamtx-viewer/viewer` and
`ghcr.io/tprjd/mediamtx-viewer/thumbnailer`. The release record contains exact
image digests, source identity, and verification evidence. An image tag alone
does not establish release readiness. A record is ready only after its exact workflow attempt completes successfully.
Run `GITHUB_REPOSITORY=tprjd/mediamtx-viewer node scripts/release-publication.mjs ready release.json`
to check this condition. Deployment must also validate the record and its freshness.

GitHub can create a new package with private visibility. If the anonymous-pull
check fails, open each package's settings and set its visibility to **Public**.
Rerun the failed workflow after both packages are public. Use **Re-run all jobs**
if the previous checks are more than 24 hours old. Keep production keys
and configuration outside the image context and GitHub Actions.

To verify the workflow before cutting a release, run **Verified ARM64 release**
manually with mode `validation`. It builds and publishes test images and saves
verification evidence, but creates no deployable release or production deployment.

To refresh an existing release's 24-hour verification evidence, run the workflow
with mode `refresh` and its tag. Select that same tag in the **Use workflow from**
field, so the workflow run identifies the release commit. It pulls and tests the recorded images without
rebuilding them. It appends a uniquely named verification asset and leaves the
original `release.json` unchanged. A moved tag or changed image identity fails.

For local ARM64 image verification, run `node scripts/release-images.mjs`. This
builds temporary local images, checks the image layers, and starts the images
with test-only runtime configuration. It does not publish or deploy them.

To stage a published release without activation, follow
[Prepare a selected release](deployment-preparation.md). Use
`sh deploy/oracle/deploy.sh prepare TARGET vX.Y.Z`, then inspect it with
`sh deploy/oracle/deploy.sh status TARGET`. Preparation keeps the current services running. Activate explicitly with
`sh deploy/oracle/deploy.sh TARGET vX.Y.Z`.
