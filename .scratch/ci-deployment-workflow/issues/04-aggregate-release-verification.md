# 04: Aggregate release evidence from independent jobs

Status: resolved
Blocked by: 03

Source: [workflow plan](../spec.md).

Split release source verification into independent jobs, then collect their reports before ARM64 image publication. Preserve the current release identity and readiness rules.

- [x] Keep the release workflow path as `.github/workflows/release.yml`. Retain tag publication, manual full validation, and existing refresh behavior.
- [x] Run all required groups for a release. Keep x64 Linux browser checks and native Linux ARM64 image checks.
- [x] Aggregate reports only when they cover the required group set and match the checked-out commit, source fingerprint, and intended workflow run.
- [x] Reject missing, failed, cancelled, conflicting, or mismatched reports. Do not use an old local report or an artifact from another workflow run.
- [x] Handle reruns explicitly. GitHub can reuse successful jobs from an earlier attempt. Resolve their exact reports and validate their origin rather than requiring every group to claim the latest attempt number.
- [x] Bind the final release record to the successful publication attempt. Keep `requireSuccessfulWorkflow` effective after the job split.
- [x] Preserve exact image digests, image-layer checks, ARM64 native dependency checks, version checks, and anonymous pulls. No required failure can produce a ready release.
- [x] Test rejection paths for report identity and completeness. Demonstrate a failed-job rerun without repeating successful deployment jobs.
- [x] Verify manual validation creates no deployable release and does not activate production. Document that validation still publishes temporary images for the anonymous-pull check.
- [x] Keep the current 24-hour rule until issue 06 changes the policy and implementation together.

Likely files: `.github/workflows/release.yml`, `scripts/release-ci.mjs`, `scripts/release.mjs`, `scripts/release-publication.mjs`, their tests, and `docs/releases.md`.

Do not reuse results across separate workflow runs in this first implementation. That optimization requires a separate provenance design.


## Comments

Implemented and pushed in 2f8cb57. Collector rejection tests cover source, run, attempt, job, command, completeness, duplicates, expiry, and failed newer attempts. Hosted aggregation and the rerun demonstration are pending final validation.

A real single-job rerun exposed GitHub retained-job copies: new job IDs and run_attempt values, but original execution and step timestamps. Commit 1f44be4 resolves these copies to their original reports. The regression test and replay of actual GitHub data accept one fresh static report and sixteen retained reports. A genuinely newer failed job still blocks aggregation. Final hosted rerun proof is pending.

Run 36749262145 on f7ad79d passed all 17 source groups and provenance aggregation. Source elapsed time was 21.9 minutes and source runner time was 110.2 minutes. The ARM64 build then exposed a SQLite lock while parallel Next.js workers loaded route modules. Commit 1518601 uses private in-memory authentication databases during the build phase; the server retains its configured persistent database. A regression test failed with SQLITE_BUSY before the fix and passed afterward. All 533 fast tests, static checks, and actual local ARM64 image builds and runtime checks passed. Hosted validation of the corrected source is pending.

Hosted proof: run 36752925565 attempt 1 passed every source group, aggregation, ARM64 image checks, and anonymous pulls. Attempt 2 reran only Verify (static). The collector selected the new static report and all sixteen original reports, with unchanged source execution timestamps. All eleven Docker groups were retained. Aggregation and image validation passed again. Unit rejection tests also cover a failed prior browser attempt and prohibit falling back after a newer failure.
