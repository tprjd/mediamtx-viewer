# 03: Stage a selected release safely

**What to build:** An operator selects a release tag and target host. The command verifies the release and prepares its images and configuration in separate staging storage while the current application continues to run.

**Blocked by:** 01: Publish verified ARM64 releases.

**Status:** resolved

Source: Verified releases and recoverable deployment spec. Covers user stories 1, 2, 10-16, 47-49, 51, and 52.

- [x] Accept a target host and selected release tag. Resolve the trusted release record produced by ticket 01 and use its commit and exact image digests. Never upload the local working directory as the release source.
- [x] Reject moved tags, mismatched commit or version, missing images, wrong architecture, incomplete required checks, and format-1 evidence older than 24 hours. Accept valid format-2 evidence without an age-based source rerun, with fresh deployment checks. Explain how to refresh verification without rebuilding under the same release identity.
- [x] Download both application images and required release configuration into staging before maintenance. A download or verification failure leaves running services, active mounted files, and databases unchanged.
- [x] Decrypt the selected release's SOPS-managed secrets on the workstation and stage them privately. Keep active secrets unchanged and do not print resolved secret-bearing configuration.
- [x] Validate required secret files, the resolved Compose model, Caddy configuration, MediaMTX syntax, and the Streaming contract in isolation from running services.
- [x] Check ARM64 host architecture, existing service state, database integrity, memory, and sampled CPU use. Preserve the existing non-capacity host limits and runtime storage requirements.
- [x] Measure free bytes and inodes on the VM and workstation where applicable. Include downloaded images, staged files, future database snapshots, encrypted copies, growth allowance, and protected recovery files. Failed or uncertain measurements stop staging readiness.
- [x] Retain the existing Compose project and persistent-volume identities. Staging does not start a second production stack or contend for live ports and database volumes.
- [x] An operation lock prevents competing staging operations from mixing source or configuration. Report the selected release, resolved images, readiness result, and reasons for rejection without private data.
- [x] Do not delete active images, the rollback release, application volumes, or protected backups to satisfy a space check. Cleanup after successful deployment is implemented in ticket 08.
- [x] Exercise staging through the deployment command against isolated Docker services and controlled release-download fixtures. Assert observable running-image identities, unchanged mounted files and data, exit status, and rejection before maintenance.
- [x] Include tests for stale evidence, wrong digests, unavailable registry, malformed configuration, changed local source, low space on either machine, and failed host checks. Keep all fixtures separate from production.
- [x] Update command guidance for preparation and status. This ticket does not activate a release or make the new deployment path the default.


## Implementation result, 2026-09-24

Implemented and pushed in `857885c5cce03a39f74264e4f5d3ad1744ed36d3` on
`feat/verified-arm64-releases`.

- Added opt-in `deploy.sh prepare TARGET TAG` and `deploy.sh status TARGET`.
  Preparation uses committed release source and exact application image digests.
  It does not activate the release or change the default deployment path.
- Isolated Docker command tests cover both Chat states, private SOPS files,
  nonroot key access, refreshed evidence, interrupted status, competing attempts,
  wrong volume mappings, configuration and registry failures, host failures,
  and insufficient workstation or host space. Tests check all original service
  identities, mounted configuration, and retained database content.
- All 495 tests pass with Node 22.22.2. Lint, type checking, the production
  webpack build, and Streaming contract validation pass. Node 22.11 cannot load
  the installed jsdom dependency; use a compatible Node runtime for the suite.
- GPT-5.6 Sol at high reasoning reviewed Standards and Spec. No hard standards,
  security, or spec findings remain. One non-blocking maintainability comment
  suggests splitting the preparation coordinator into smaller phases.
- Ticket 01 still requires its hosted ARM64 acceptance run. Controlled fixtures
  establish this ticket's command behavior; no production release was staged
  or activated during implementation.

The issue tracker and pre-existing planning documentation remain local and were
not included in the implementation commit.

## Comments

### 2026-09-30: Evidence policy updated

[CI issue 06](../../ci-deployment-workflow/issues/06-separate-evidence-and-freshness.md) implements durable format-2 evidence and retains format-1 expiry. Hosted acceptance for ticket 01 has passed. Earlier implementation notes remain as history. Further validation is deferred at the user's request.
