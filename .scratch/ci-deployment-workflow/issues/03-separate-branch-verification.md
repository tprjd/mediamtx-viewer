# 03: Separate branch checks from release publication

Status: resolved
Blocked by: 01, 02

Source: [workflow plan](../spec.md).

Add branch verification with independent jobs. Remove the feature-branch push trigger from full release validation after replacement checks work.

- [x] Add a branch workflow for pull requests and manual runs. Support the current feature branch while avoiding duplicate push and pull-request runs for the same change.
- [x] Run static checks, fast tests, browser tests, and production build in separate jobs. Preserve configuration validation.
- [x] Use branch-specific concurrency and cancel obsolete branch runs. Leave release publication non-cancelling and separate.
- [x] Keep branch permissions read-only. Do not authenticate to GHCR, publish images, or create release records.
- [x] Run Docker deployment acceptance for changes to deployment logic, migrations, images, verification infrastructure, or their dependencies. Default to running it when dependency impact is uncertain. Offer explicit full validation.
- [x] Keep every Docker acceptance group mandatory in release verification, regardless of development path filters.
- [x] Give each job its own test data and outputs. Upload useful failure reports and timings for seven days.
- [x] Verify replacement status-check names against repository branch protection before retiring existing checks. Do not leave required checks permanently pending because a job or workflow was skipped.
- [x] Demonstrate that a branch update cancels an obsolete verification run and that a branch run cannot publish images.

Likely files: a new `.github/workflows/ci.yml`, `.github/workflows/release.yml`, and verification documentation.

Use standard hosted runners. Do not add a self-hosted runner or alter production activation.


## Comments

Implemented and pushed in 5ff6db1. Branch jobs are read-only and cannot publish images. Path selection is conservative. Old branch runs were observed cancelling after pushes. GitHub main has no existing branch protection requirements. Final hosted validation remains in progress.

Final branch workflow run 36747315761 is running on 1f44be4. Its permissions remain read-only and it contains no publication job.

Final branch run [36749241646](https://github.com/tprjd/mediamtx-viewer/actions/runs/36749241646) passed on f7ad79d. It selected six groups and no Docker acceptance or publication jobs for the browser-only change. The release browser job in run 36749262145 independently passed 77 tests with nine configured skips, zero retries, in 5.1 minutes.

Final branch run 36756829244 passed all six selected groups on 9aa606b without image publication or Docker acceptance jobs. The tracked working tree is clean and HEAD matches its configured upstream.
