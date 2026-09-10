# Versioning plan

Use Semantic Versioning for the application. The version applies to the whole
viewer release, not to the streaming contract or the OBS setup script. Those
have their own versions and stay independent.

This plan is implemented.

## Planned version sources

- `package.json` and `package-lock.json` store the release version.
- The build will derive `APP_VERSION` from `package.json` for the server and
  client. There is no duplicate version string to keep in sync.
- `/api/health` will include the version in its JSON response.
- The site header will show the version as a superscript next to the brand.

Change `package.json` and `package-lock.json` when a release is cut. The build
derives the runtime version from them.

## Historical mapping

The first project versions did not have release tags. The tags now mark the last
commit in each milestone.

| Version | Date range | Milestone |
| --- | --- | --- |
| 0.1.0 | 2026-08-29 | Initial MediaMTX viewer |
| 0.2.0 | 2026-08-30 | Approved accounts, owned channels, thumbnails, dashboard |
| 0.3.0 | 2026-08-31 to 2026-09-01 | OBS setup, Oracle statistics, SSE status |
| 0.4.0 | 2026-09-02 | Balanced and low-latency playback, Vidstack controls |
| 0.5.0 | 2026-09-03 to 2026-09-04 | Streaming contract, keyboard shortcuts, theme, dashboard list |
| 0.6.0 | 2026-09-04 | Discord notifications, footer, and explicit versioning |
| 0.6.1 | 2026-09-04 | Footer redesign |
| 0.6.2 | 2026-09-05 | CSS modules and responsive layout fixes |
| 0.7.0 | 2026-09-05 to 2026-09-06 | SOPS secrets and Enhanced RTMP publishing |
| 0.8.0 | 2026-09-07 | Adaptive playback availability and HLS fallback |
| 0.9.0 | 2026-09-08 to 2026-09-10 | Twitch-style layout and local streaming stack |

## Bump policy

- Patch release: a fix that does not change user-facing behavior.
- Minor release: a new feature that is backward compatible.
- Major release: a breaking change to accounts, playback, or deployment.

For a small private site, minor releases are likely to be the common case.

## Commit style

Write commit messages in Conventional Commits style. Use a type and a short
description, for example `feat`, `fix`, `docs`, `refactor`, `test`, or `chore`.
The changelog groups changes by the type in the commit message.

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
- Keep the header version small and unobtrusive, with no active link of its own.
