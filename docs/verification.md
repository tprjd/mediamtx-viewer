# Run verification

Use Node 24. Run `npm ci` after selecting that version. Native modules must match the selected Node runtime.

Run `npm run verify -- list` to list the verification groups. Run `npm run verify -- GROUP` to execute one group. Reports are written to `.data/verification/` and include source identity, commands, outcomes, and durations.

Use `npm run test:fast` for tests that do not start Docker. Use `npm run test:docker` for Docker integration and deployment tests. Both commands accept Vitest file filters after `--`. `npm test` still runs the complete Vitest suite.

For a focused Chat history check, run:

```sh
CI=1 npx playwright test tests/e2e/chat.spec.ts --project=chat-chromium --grep 'browses retained Chat history' --workers=2 --retries=0
```

For repeated Chat checks, add `--repeat-each=10 --workers=1`. Chat scenarios share a seeded database, so concurrent repetitions can overwrite each other's fixtures.

Run `npm run verify` for all required release source checks. This includes the production build, browser suite, independent restore drill, configuration checks, and both Vitest groups. The independent restore drill intentionally repeats its browser scenario in a fresh browser run.

Install and start Docker with Compose v2 before Docker, browser, restore, or configuration checks. Deployment tests accept only a local Docker endpoint. They create isolated fixtures and do not connect to Oracle.

Install `age`, including `age-keygen`, and SOPS before the Docker groups. On macOS, use `brew install age sops`. For browser and restore checks, run `npx playwright install --with-deps chromium`.

Use x64 Linux to reproduce hosted browser behavior. macOS screenshots and Linux screenshots can differ. The current Linux ARM64 Chromium cannot decode the H.264 test media. Final application images require separate native Linux ARM64 verification.

The required groups and commands are defined in `scripts/verification-checks.mjs`. Docker test membership is defined in `scripts/test-groups.json`. When a new test starts Docker, add it to that list so fast verification stays independent of Docker.

Each Docker test file has a `docker-<name>` verification group. For example, run `npm run verify -- docker-stage-release` to check staging. The full command requires every partition. Hosted workflows run at most six groups at once on separate machines. Local `verify` runs groups in sequence.

Staging scenarios reuse the common fixture image when its input files and Docker endpoint match. Scenario state stays separate. Local fixture base images have the repository name `mediamtx-test-base`; remove those images when no tests are running if you need to reclaim disk space.

Local reports support diagnosis. They do not authorize a GitHub release or production deployment.

GitHub runs **Branch verification** for pull requests to `main`, pushes to `main`, and the current deployment feature branch. When that feature branch has an open pull request, its push run leaves testing to the pull-request run. New updates cancel obsolete runs of the same event and branch.

Each verification group has its own job. Changes limited to components, hooks, public assets, browser tests, or documentation omit Docker acceptance. Unknown inputs and deployment dependencies run all groups. Select a manual run with `full` enabled to run every group. The **Branch checks** job reports the combined result. Branch jobs cannot publish images.

Release tags and explicit release validation still require every group. Keep the full release workflow separate from branch checks. Reports and browser failure traces remain available for seven days. Browser checks use zero retries and retain the trace from the first failed attempt.

Source fingerprints cover the shared GitHub action as well as workflow files. They exclude `next-env.d.ts`, which Next.js regenerates for each test build directory. The Next.js version and compiler configuration remain fingerprint inputs.

The administrator browser project runs after the desktop and mobile viewer projects because it changes their shared Channel database. To run it alone, use `npx playwright test --project=administrator-chromium --no-deps --workers=1`. Chat uses a separate database.

Browser fixtures run a production standalone build, so page compilation cannot delay a click or consume a rate-limit window during a test. The two fixture servers share immutable build files and use separate databases. Local runs reuse the build only when the source fingerprint and Node platform/version match. The independent restore job prepares its own build on a fresh hosted runner.

Next.js build workers use separate in-memory authentication databases when they load route modules. They do not open the runtime database during a build. The running server still uses `AUTH_DB_PATH` and persistent storage.
