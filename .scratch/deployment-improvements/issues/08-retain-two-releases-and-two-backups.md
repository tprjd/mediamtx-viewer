# 08: Retain two releases and two backups

**What to build:** After a successful deployment, cleanup keeps the current release, the previous successful release, and two complete deployment backup sets on each machine. Files needed for an unresolved deployment or recovery remain protected.

**Blocked by:** 06: Recover interrupted deployments.

**Status:** resolved

Source: Verified releases and recoverable deployment spec. Covers user stories 14, 25, 44-49, 51, and 52.

- [x] Use successful deployment records and recovery protections to select retained releases. Keep two releases total: current and previous successful, including their exact images, configuration, mounted files, and required private secrets.
- [x] Keep the two newest complete verified deployment backup sets on both VM and workstation. Count whole sets, not individual encrypted database files. A failed or incomplete transfer does not displace a verified complete set.
- [x] Keep daily backups and their seven-day rotation separate. Deployment cleanup must not shorten daily backup retention or alter Chat message retention.
- [x] Protect every release, image, configuration file, secret, and backup referenced by an unresolved attempt. Explicitly report why protected files exceed the ordinary count.
- [x] Permit temporary space for the staged candidate and in-progress backup. Cleanup of successful history occurs only after activation and health acceptance. A failed deployment must not rotate away its recovery point.
- [x] Never delete an application volume or the only usable rollback state. Shared images or files remain until no retained release references them. Avoid broad Docker or filesystem cleanup that cannot establish ownership.
- [x] Registry cleanup must preserve digests referenced by current and previous successful deployments. A newer published but undeployed build cannot evict either image. If protected references cannot be established, keep the image and report the unresolved cleanup.
- [x] Measure space before staging, backup, and activation on the VM and workstation. If protected files leave insufficient space, fail before changes rather than weakening retention protection to continue.
- [x] Reconcile workstation cleanup after reconnecting without deleting a backup needed by an unresolved host attempt. Cleanup failures preserve protected files and report the remaining work.
- [x] Test through repeated command-level deployments with real encrypted sets and observed image identities. Prove the two-release and two-set limits after clean success.
- [x] Include failures, same-day deployment sets, daily rotation overlap, changed encryption keys, unreadable complete sets, shared image digests, an undeployed newer build, disconnected workstation cleanup, and unresolved recovery protection.
- [x] Update retention and disk guidance with the normal counts, temporary staging allowance, and unresolved-failure exception. Do not change registry visibility, pricing assumptions, or the existing scheduled backup policy.


## Comments

### 2026-09-25: Implementation complete; Docker validation deferred

Implemented in commit `fa6d6c7` on `feat/verified-arm64-releases`. Cleanup retains current and previous successful releases and two acknowledged, verified encrypted backup sets on each machine. It protects unresolved recovery files, preserves unreadable sets, and supports cleanup after reconnecting. Registry deletion remains disabled.

Seven short retention tests, lint, type checking, the production build, and shell syntax checks passed. Standards and specification reviews have no remaining code findings. The short tests include real encrypted sets, same-day sets, changed keys, damaged sets, daily rotation overlap, unresolved protection, and a failed private-file cleanup followed by retry.

The operator requested that long Docker tests be deferred. The new tests cover repeated deployments, shared image identities, interrupted workstation cleanup, and actual recovery artifacts after failure. They have not been run. An existing backup test file unexpectedly imported Docker tests during validation; that run was stopped and is not used as completion evidence.

Run the deferred retention checks with local Docker, SOPS, and age:

```sh
npx vitest run scripts/deployment-retention-docker.test.mjs
```

Also run the existing deployment, recovery, and backup suites before release. No production deployment was performed.

### 2026-09-25: Deferred Docker acceptance passed

The operator authorized the long checks. Both retention Docker tests passed, including repeated deployments with two retained releases and two encrypted sets, interrupted workstation cleanup, eligible rollback, and unresolved recovery protection. The activation fault fixture now fails once per attempt, so it does not also prevent recovery to the same previously deployed image. Combined validation log: `/tmp/deployment-docker-recheck.log`. Ticket 09 tracks the remaining hosted acceptance of the complete process.
