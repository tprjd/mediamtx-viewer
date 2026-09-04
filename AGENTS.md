<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Domain language

- Read `CONTEXT.md` before changing account access, channels, OBS setup,
  playback, or viewer identity. Use its canonical terms in code and docs.

# Streaming contract

- Read `config/streaming-contract.v1.json` before changing HLS timing, buffering,
  managed OBS keyframes, or playback fallback policy. It is authoritative;
  timing values in `docs/*plan.md` are historical.
- Read `lib/playback-run.ts` and `components/use-playback-run.ts` before changing
  player state, pause handling, progress detection, or recovery eligibility.
  Keep transport actions in the HLS and WebRTC adapters. Keep cross-protocol
  selection in `components/use-playback-mode.ts`.

# UI components

- Before building a custom modal, popover, tooltip, dropdown, or similar
  interactive UI primitive, check whether Radix UI already provides it. Prefer
  Radix primitives over hand-rolled implementations. If the needed package is
  not installed, add it with `npm install @radix-ui/<package>` rather than
  reimplementing the behavior.

# Versioning

- Read `docs/versioning-plan.md` before changing a release version.
- Keep `package.json` and `package-lock.json` in sync. Derive `APP_VERSION`
  from `package.json`; do not keep a duplicate version string.
- Add a Keep a Changelog entry and an annotated `vX.Y.Z` git tag when cutting
  a release.
- Run lint, tests, and build before tagging.
- Do not bump the version for docs-only or planning changes.
- Once implemented, show `APP_VERSION` in the footer and in `/api/health`.

# Delivery workflow

- After completing an implementation task, run the relevant checks, commit only the task-related changes with a concise commit message, and push the current branch to its configured upstream unless the user explicitly asks not to.
- Review the working tree before committing and exclude unrelated or pre-existing changes.
- Do not commit or push for read-only reviews, explanations, diagnoses, status checks, or planning tasks.
- Never force-push. If verification fails, no upstream is configured, credentials are unavailable, or the push is rejected, report the problem instead.
