# 06: Separate release evidence from deployment freshness

Status: resolved
Blocked by: 04

Source: [workflow plan](../spec.md).

Approved implementation policy: successful source tests remain evidence for the exact source and immutable image digests. Deployment performs fresh operational checks each time. An unchanged release does not need the full source test suite again solely because 24 hours passed.

The user requested implementation of all six steps. The deployment spec now defines format-2 durable evidence, format-1 compatibility, fresh operational checks, and revocation by draft or removal. Issues 01 through 05 retain the current creation-time freshness rule.

- [x] Define the scope of durable test evidence. It proves the tested source and images, not current vulnerability status or current host readiness.
- [x] Retain the successful GitHub workflow requirement, full required-check coverage, annotated tag identity, source fingerprint, and exact image digests.
- [x] Define fresh deployment checks: image availability and identity, resolved configuration, host resources and disk space, database state, backup verification, and candidate runtime health.
- [x] Reject missing or inaccessible evidence and mismatched or moved identities. Preserve explicit release revocation if an accepted mechanism exists, or define one before claiming revoked releases are blocked.
- [x] Specify compatibility for existing release records. Never accept old records merely by ignoring every age or schema error.
- [x] Change the spec, release validation, staging validation, tests, and operator documentation together. Replace the mandatory full refresh procedure with the agreed operational checks.
- [x] Test an unchanged release older than 24 hours, a failed workflow, missing evidence, a changed digest, a moved tag, and a failed fresh host check.
- [x] Preserve migration failure handling and rollback eligibility. Durable test evidence must not authorize activation when current preflight checks fail.

Likely files: the existing deployment spec, `scripts/release.mjs`, `scripts/stage-release-source.mjs`, related tests, `docs/releases.md`, and deployment preparation documentation.

Recommendation: make this change after the workflow is reliable. It removes repeated verification for delayed deployments, but it does not fix the current browser failure.


## Comments

Implemented and pushed in 6acf2c0. New record format 2 has durable source/image evidence; format 1 retains 24-hour expiry and refresh preserves format. The deployment spec and operator docs define revocation, compatibility, and fresh operational checks. HTTP-boundary tests reject missing/failed workflows, moved tags, changed refreshed digests, invalid records, and draft/unpublished releases. All 530 fast tests, static checks, and five real staging tests pass. A two-day-old release still fails a fresh host-space check and succeeds after the host fault is cleared.

Final source verification on f7ad79d passed all 17 groups. The current fast suite has 531 passing tests. Real staging, activation, migration, recovery, retention, and Chat deployment groups passed with the format-2 policy in place. No production deployment or release tag was created.
