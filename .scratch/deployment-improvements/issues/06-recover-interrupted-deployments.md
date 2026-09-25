# 06: Recover interrupted deployments

**What to build:** After a workstation disconnect or VM restart, the operator can inspect the same deployment attempt and recover it without repeating completed changes. Uncertain operations stay in maintenance, and a second deployment cannot bypass the unresolved attempt.

**Blocked by:** 05: Deploy migrations with explicit recovery.

**Status:** resolved

Source: Verified releases and recoverable deployment spec. Covers user stories 15, 24, 30-36, 46, 48, 49, 51, and 52.

- [x] Extend the existing host-side phase record and lock to cover interruption at staging, maintenance, backup transfer, migration, activation, rollback, and completion boundaries.
- [x] Status works from a fresh workstation connection and identifies the original attempt, selected and previous releases, backup, phase, observed result, and permitted recovery action.
- [x] Persist the maintenance decision and prevent normal application startup from bypassing unresolved recovery after a host restart. A restarted service must not automatically rerun an uncertain migration phase.
- [x] Migration cannot begin until the verified workstation copy has been acknowledged for that exact attempt and backup set. An interrupted transfer, old acknowledgement, or lost client is not permission to proceed.
- [x] Reconcile completed work using observed container identities, private mounted state, backup verification, and real database migration records. Do not infer completion from a client exit, log line, or stale lock alone.
- [x] A repeated command does not rerun committed migrations, replace backup evidence, or start an overlapping deployment. Distinguish an active owner from an abandoned attempt before allowing explicit recovery.
- [x] After interruption, automatic rollback remains subject to known state and no newly applied migration in either database. Unknown or partially migrated state remains in maintenance and requires the explicit recovery operation.
- [x] Protect required images, configuration, secrets, and backup sets until the attempt is resolved. Make those protections available to retention cleanup without exposing private values.
- [x] Use stable operational result categories and nonzero status for unresolved or failed attempts. Reports must be useful after reconnecting without reconstructing earlier shell output.
- [x] Exercise real process termination and reconnection against the isolated host. Cover loss before workstation acknowledgement, during each migration phase, after service replacement, during rollback, and after successful activation but before the client receives the result.
- [x] Exercise host restart behavior in the isolated environment. Verify maintenance persistence, migration suppression, attempt identity, safe retry behavior, and explicit recovery completion through the operator commands.
- [x] Include overlapping deployment and scheduled-operation tests. Confirm that recovery does not steal an active operation's lock or remove its recovery files.
- [x] Update interruption and recovery guidance, including what the operator must inspect before clearing a stale operation. Do not introduce automatic database restore or make the new deployment process the default yet.


## Implementation notes

- The operator commands are the agreed test boundary. Tests use real Docker
  processes, SQLite migrations, encrypted backup copies, and HTTP responses.
- A host `flock` belongs to the attached connection. Workstation child commands
  inherit its connection descriptor, so an in-flight Docker command retains
  ownership after its parent exits. Token and process checks reject an old owner.
- Attempt labels cover interruption before tool initialization. Durable records
  cover staging, backup acknowledgement, migration, activation, rollback, and
  completion. Recovery uses the original attempt and rechecks actual state.
- Completion reconciliation supports missing cleanup helpers and repeated recovery.
  A rejected recovery choice cannot stop a completed healthy deployment.
- The protection record exposes source paths, image references, and backup sets
  for future retention work. It does not expose configuration or secret values.
- Standards review corrected the maintained guide and consolidated completion
  writes. Spec review found and corrected rollback completion, interrupted cleanup,
  and invalid repeated-recovery behavior. The final ownership review had no finding.
- Operator guidance is in `docs/deployment-recovery.md` and linked from
  `docs/managed-deployment.md`. The legacy deployment remains the default.

## Verification

- Lint, type checking, and the production build passed.
- The full test run passed 224 tests in 23 files. Its isolated Docker restart
  fixture failed because runtime PID files survived the simulated restart.
  Mounting `/run` as temporary storage corrected the fixture; the final restart
  test passed with the final connection implementation.
- Node 22.11 could not load the browser test environment. All 37 affected files
  passed on the installed Node 22.22.2 runtime (309 tests).
- Targeted operator-command checks passed for changes made during review,
  including interrupted initialization, stale backup acknowledgement, a child
  command retaining ownership after parent termination, completion cleanup,
  repeated recovery, rollback retry, and the standalone resume guard.
- Standards and specification reviews are complete. All reported defects were
  corrected and verified.
