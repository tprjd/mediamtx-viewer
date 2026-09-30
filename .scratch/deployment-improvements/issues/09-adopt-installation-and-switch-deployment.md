# 09: Adopt the existing installation and switch deployment

**What to build:** The operator can move the existing Oracle installation onto the new deployment process with a recoverable previous state. The verified tag-based command becomes the documented default, and operational jobs follow the active release.

**Blocked by:** 07: Enable Chat without capacity benchmarks; 08: Retain two releases and two backups.

**Status:** resolved

Source: Verified releases and recoverable deployment spec. Covers user stories 11, 12, 16, 25, 32, 37-50, 51, and 52. Provides final integration acceptance for all 52 stories.

- [x] Add an adoption path that captures the existing installation's actual service image identities, resolved configuration, mounted files, required secrets, effective Chat state, and persistent-volume ownership before the first managed activation.
- [x] Verify the baseline is usable for recovery and mark it as adopted. Do not claim that it passed the new GitHub verification sequence. If required baseline state is missing or inconsistent, reject activation and report a repair action.
- [x] Preserve the existing Compose project, application data, Caddy state, derived thumbnails, and notifier state. Adoption must not recreate empty application volumes or provision a replacement VM.
- [x] Apply the new preflight, maintenance, encrypted workstation backup, migration, health, rollback, and recovery rules to the first managed deployment. The existing installation is its retained previous runtime state.
- [x] Preserve the current effective Chat state and resolve obsolete application-owned capacity trial timers. Keep explicit Chat enable, disable, and health operations working after adoption.
- [x] Update scheduled backup and other operational job references to follow the active deployment. Verify that daily jobs do not continue invoking obsolete code or interfere with deployment recovery.
- [x] Make the selected-tag command the normal deployment entry point only after the dependent capabilities pass. Remove or clearly retire the old working-directory upload and VM-build procedure so it cannot silently remain the documented default.
- [x] Keep the operator's manual control over production activation. Tag pushes build and verify images; they do not automatically connect to or deploy on Oracle.
- [x] Update release, deployment, Chat rollout, backup, retention, and recovery guidance. Replace planned-policy notices with implemented behavior and remove contradictory active capacity requirements. Preserve the historical unverified-capacity statement.
- [x] Preserve application-version derivation and visibility in the header and health response. Do not cut a release or change versions merely to complete planning or tests; follow the existing release policy when a release is requested.
- [x] Demonstrate the complete path against an isolated installation that matches the legacy layout: adopt, deploy a verified release, preserve both possible Chat states, recover an eligible failure, reject unsafe migration rollback, reconnect after interruption, and retain the required history.
- [x] Verify actual scheduled-job execution against the active release in the isolated environment. Check public maintenance and health responses, exact images, mounted configuration, database contents, and retained backups rather than relying on configuration text alone.
- [x] Run the required lint, type, unit, integration, browser, build, Streaming contract, proxy, backup, and deployment checks. Reuse the proven hosted ARM64 image workflow from ticket 01 and confirm it still works with the completed process.
- [x] Do not perform a live Oracle deployment, restore production databases, rotate external credentials, or provision infrastructure as part of this implementation ticket without an explicit live-operation instruction.

## Comments

### 2026-09-25: Implementation complete; full acceptance deferred

Implemented in commit `feb24a7` on `feat/verified-arm64-releases`. Added adoption of the actual running installation, including exact image identities, private mounted files and secrets, effective Chat state, external volumes, and ownership evidence. The adopted baseline is explicitly unverified by GitHub. Recovery uses captured images and configuration without startup migrations. A durable provisional record permits recovery after an interrupted restart-policy change.

The default deployment entry point now requires a selected tag. The old upload and VM-build entry point is retired. Production activation remains manual. The installed backup runner selects the active viewer and Caddy containers and refuses to run while deployment owns the installation. Documentation covers adoption, the first managed deployment, backup jobs, Chat, retention, and recovery.

Validation passed: 19 focused tests, lint, type checking, the production build, shell syntax, and diff whitespace checks. Standards and specification reviews found no remaining code findings. No Docker tests were run, as requested. Full integration, browser, proxy, backup, deployment, and hosted ARM64 acceptance remain pending. The selected-tag entry point is implemented, but its complete acceptance gate is not claimed as passed.

The new isolated legacy-layout tests cover both Chat states, adoption, first deployment, eligible rollback, migration rollback rejection, recovery after interruption, retained history, and actual execution of the installed backup runner against active containers. These tests have not been run. Run with Docker, SOPS, and age available:

```sh
npx vitest run scripts/adoption-docker.test.mjs
```

Run the existing deployment, recovery, backup, and retention suites and the hosted ARM64 workflow before production use. No live Oracle operation, version change, credential rotation, or infrastructure change was performed.

### 2026-09-25: Isolated Docker acceptance passed

The operator authorized the deferred checks. All four adoption scenarios passed across the targeted runs, including both Chat states, installed backup-runner execution before and after activation, eligible rollback, migration rollback rejection, interrupted recovery, and retained history. The tests invoke the installed daily job against real containers; the host systemd installation boundary remains isolated by the test fixture.

Commit `ebae1bc` fixes adopted rollback comparison when Compose omits empty named-volume options. Explicit non-default options still require an exact match. The retention suite also passed both tests. Logs: `/tmp/deployment-adoption-fixed.log` and `/tmp/deployment-docker-recheck.log`. Full hosted acceptance of the final commit is still pending. No production operation was performed.

### 2026-09-25: Hosted failures isolated

Hosted run https://github.com/tprjd/mediamtx-viewer/actions/runs/36178142581 failed after 38 minutes 41 seconds: 556 tests passed and 13 failed. Eight failure reports included the host CPU/memory rejection. The ARM64 job was skipped.

Commit `3799692` gives isolated deployment fixtures deterministic healthy CPU/memory readings while retaining the explicit unhealthy cases. Production checks are unchanged. A real fixture probe passed healthy preparation and confirmed rejection for high CPU and low memory. The separate Chat cleanup test passed locally in 124 seconds. Lint and 23 release tests passed. Release tests now stop after failure to shorten diagnosis. The remaining Chat timeout and full hosted acceptance still require a successful run.

### 2026-09-30: Implementation and hosted acceptance complete

[Hosted run 36752925565](https://github.com/tprjd/mediamtx-viewer/actions/runs/36752925565) passed on `1518601`. All 17 source groups passed, including all 11 Docker suites. Both native ARM64 images passed layer inspection, runtime checks, and anonymous digest pulls. A second attempt reran the static group and retained the other 16 successful executions.

The final browser-fixture-only change, `9aa606b`, passed [all six branch groups](https://github.com/tprjd/mediamtx-viewer/actions/runs/36756829244). The browser suite passed 77 tests with nine configured skips and no retries. These results resolve the earlier hosted acceptance blockers. No release tag or production deployment was made during this work.

The user deferred further validation. This status update records existing results and does not start another test run.
