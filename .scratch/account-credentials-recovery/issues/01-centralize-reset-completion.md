# 01: Centralize Account credentials recovery completion

Status: ready-for-agent
Blocked by: none

## Scope

Implement the complete [Account credentials recovery spec](../spec.md).
This is one ticket because the ownership change and its acceptance tests form one independently verifiable change.

## Acceptance criteria

- [ ] One recovery module owns hashing, token selection, and the complete SQLite transaction.
- [ ] The reset form action owns validation and response messages without direct database or token-source coordination.
- [ ] Both token sources preserve their current checks, lookup order, and failure behavior.
- [ ] Reset-only token consumption is private to recovery completion. Email verification and token issuance keep their existing behavior.
- [ ] Tests use the existing reset action with real SQLite and cover the spec's acceptance matrix.
- [ ] The existing SMTP integration test remains effective.
- [ ] The account access guide identifies the recovery module and its responsibility.
- [ ] Relevant account tests, lint, type checks, and the production build pass.
- [ ] Standards and Spec reviews have no unresolved actionable findings.

## Comments

- 2026-10-07: Created from the approved spec for implementation by an Astra subagent at xhigh effort. No prerequisite tickets.
