# 01: Centralize Account credentials recovery completion

Status: resolved
Blocked by: none

## Scope

Implement the complete [Account credentials recovery spec](../spec.md).
This is one ticket because the ownership change and its acceptance tests form one independently verifiable change.

## Acceptance criteria

- [x] One recovery module owns hashing, token selection, and the complete SQLite transaction.
- [x] The reset form action owns validation and response messages without direct database or token-source coordination.
- [x] Both token sources preserve their current checks, lookup order, and failure behavior.
- [x] Reset-only token consumption is private to recovery completion. Email verification and token issuance keep their existing behavior.
- [x] Tests use the existing reset action with real SQLite and cover the spec's acceptance matrix.
- [x] The existing SMTP integration test remains effective.
- [x] The account access guide identifies the recovery module and its responsibility.
- [x] Relevant account tests, lint, type checks, and the production build pass.
- [x] Standards and Spec reviews have no unresolved actionable findings.

## Comments

- 2026-10-07: Created from the approved spec for implementation by an Astra subagent at xhigh effort. No prerequisite tickets.
- 2026-10-07: Claimed in `codex/account-recovery-implementation` for implementation and verification.
- 2026-10-07: Added `lib/auth/account-credentials-recovery.ts` and 46 action-level SQLite cases. All 46 cases passed against the previous implementation before the refactor and passed after it. The tests cover source selection, validation, credential matching, stored account state, and rollback with a real SQLite trigger.
- 2026-10-07: Node 24.15.0 verification passed after `npm ci`: `npm run test:fast -- lib/auth app/account/account-details.test.tsx lib/account-restrictions.integration.test.ts lib/viewing-access.integration.test.ts --reporter=verbose` passed 127 tests in nine files, including SMTP delivery. `npm run verify -- static` passed lint, type checks, and the streaming contract check. `npm run verify -- build` passed the production webpack build. Standards and Spec reviews remain pending.
- 2026-10-07: Implementation commit `c9addaf` integrated into `codex/account-credentials-recovery`. Independent Standards and Spec reviews against `c4faa8c` found no actionable issues. Resolved in [PR #3](https://github.com/tprjd/mediamtx-viewer/pull/3).
