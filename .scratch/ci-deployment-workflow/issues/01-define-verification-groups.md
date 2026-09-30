# 01: Define verification groups and local commands

Status: resolved
Blocked by: none

Source: [workflow plan](../spec.md).

Create independently runnable groups for static checks, fast tests, browser tests, Docker deployment acceptance, the independent restore drill, production build, and configuration validation.

- [x] Inventory the actual tests and fixture dependencies. Record baseline durations without assuming all long tests need Docker.
- [x] Add clear package commands for focused groups and full verification. Preserve the full coverage of `npm test`.
- [x] Keep one group definition shared by local execution and GitHub orchestration. Preserve the existing required-check meaning when a group is split.
- [x] Give each group an isolated report with source identity, command, start and finish times, duration, and outcome. Write failure reports even when a command exits unsuccessfully.
- [x] Define prerequisites for Node 24, Chromium, Docker, age, and SOPS. A missing required tool must fail with an actionable message.
- [x] Compare test discovery before and after the split. No test can disappear because it matches neither group.
- [x] Run the fast group and verify that it does not start Docker fixtures. Run representative Docker tests through their new command.
- [x] Document the focused browser command and the full local verification command.

Likely files: `package.json`, `vitest.config.ts`, `scripts/verification-checks.mjs`, `scripts/chat-capacity/checks.mjs`, and verification documentation.

Do not change test behavior, release freshness, or production deployment in this issue.


## Comments

Implemented and pushed in cae0b57. The inventory retains all 70 original test files; 11 require Docker. The fast and Docker commands cover the full Vitest suite. Reports record failures, commands, source identity, and duration. The current fast suite passes 530 tests without Docker fixtures.
