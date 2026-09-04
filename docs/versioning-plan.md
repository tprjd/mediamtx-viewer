# Versioning plan

Use Semantic Versioning for the application. The version applies to the whole
viewer release, not to the streaming contract or the OBS setup script. Those
have their own versions and stay independent.

This plan is not implemented yet.

## Planned version sources

- `package.json` and `package-lock.json` store the release version.
- The build will derive `APP_VERSION` from `package.json` for the server and
  client. There is no duplicate version string to keep in sync.
- `/api/health` will include the version in its JSON response.
- The site footer will show the version as `v0.6.0`.

Change `package.json` and `package-lock.json` when a release is cut. The build
derives the runtime version from them.

## Historical mapping

The project did not carry explicit release tags, so the versions below assign
a sensible baseline from the commit history.

| Version | Date range | Milestone |
| --- | --- | --- |
| 0.1.0 | 2026-08-29 | Initial MediaMTX viewer |
| 0.2.0 | 2026-08-30 | Approved accounts, owned channels, thumbnails, dashboard |
| 0.3.0 | 2026-08-31 to 2026-09-01 | OBS setup, Oracle statistics, SSE status |
| 0.4.0 | 2026-09-02 | Balanced and low-latency playback, Vidstack controls |
| 0.5.0 | 2026-09-03 to 2026-09-04 | Streaming contract, keyboard shortcuts, theme, dashboard list |
| 0.6.0 | Current tip | Discord notifications, footer, and explicit versioning |

## Patch candidates

The project never tagged patch releases, so these are the notable fixes that
would have been patch versions if tags had existed.

| Version | Date | Commit | Fix |
| --- | --- | --- | --- |
| 0.2.1 | 2026-08-30 | `74b1295` | Fix AV1 thumbnail capture |
| 0.3.1 | 2026-08-31 | `39d9c19` | Fix OBS setup mode check and channel header |
| 0.3.2 | 2026-08-31 | `aa4a6a5` | Fix OBS managed file replacement |
| 0.3.3 | 2026-08-31 | `cccceb8` | Fix OBS game capture presets |
| 0.3.4 | 2026-09-01 | `8e306aa` | Fix stalled WebRTC video recovery |
| 0.4.1 | 2026-09-02 | `3cec3fc` | Fix playback recovery and fullscreen HUD |
| 0.5.1 | 2026-09-04 | `cb80fc9` | Fix OCI byte metric aggregation |
| 0.6.1 | 2026-09-04 | `4f86cd4` | Fix Discord notifier script mount path |

## Bump policy

- Patch release: a fix that does not change user-facing behavior.
- Minor release: a new feature that is backward compatible.
- Major release: a breaking change to accounts, playback, or deployment.

For a small private site, minor releases are likely to be the common case.

## Release steps

1. Update `package.json` and `package-lock.json`.
2. Add a dated Keep a Changelog entry to `CHANGELOG.md`.
3. Run lint, tests, and build.
4. Tag the commit with `git tag -a v<version> -m "Release v<version>"`.
5. Push the commit and the tag with `git push origin main --tags`.
6. Deploy.

## Recommended additions

- Add a `CHANGELOG.md` that follows Keep a Changelog.
- Start tagging releases with annotated `git tag -a vX.Y.Z` tags.
- Put the version in `/api/health` so deploy checks can confirm the running
  release.
- Keep the footer version small and unobtrusive, with no active link.
