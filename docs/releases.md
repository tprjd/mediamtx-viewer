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
7. Follow the [deployment procedure](../deploy/oracle/README.md).
8. Confirm that the header and `/api/health` show the release version.

`lib/app-version.ts` derives `APP_VERSION` from `package.json`. Keep that file
as the runtime version source.
