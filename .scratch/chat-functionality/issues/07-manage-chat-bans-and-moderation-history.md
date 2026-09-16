# 07: Manage Chat bans and moderation history

**What to build:** Let Chat moderators apply and reverse indefinite Chat bans, manage active restrictions, and let administrators review durable Chat moderation records.

**Blocked by:** 06: Apply and enforce Chat timeouts

**Status:** resolved

- [x] A Channel owner can apply a Chat ban only in their own room
- [x] An administrator can apply a Chat ban in any room, including to its Channel owner
- [x] A Channel owner cannot apply a Chat ban to an administrator
- [x] A Chat ban remains active until an authorized Chat moderator lifts it
- [x] A banned participant keeps Viewing access and can read the room
- [x] A banned participant cannot send through the UI or a direct HTTP request
- [x] Applying a Chat ban removes the target's messages from the previous ten minutes
- [x] The participant-specific control channel reports the category and indefinite state without exposing moderator identity or notes
- [x] The room receives tombstones but no public Chat ban announcement
- [x] An administrator's Chat ban of a Channel owner suspends that owner's Chat moderation authority
- [x] A room panel lists active Chat timeouts and Chat bans for authorized moderators
- [x] A Channel owner can reverse only an action that a Channel owner made in that room
- [x] An administrator can reverse any Chat timeout or Chat ban
- [x] Reversal restores sending and any suspended moderation authority without a page reload
- [x] Reversal creates a durable Chat moderation record and a private control event
- [x] Administrators can browse a paged list of Chat moderation records across rooms
- [x] The record list shows action, category, actor, target, room, state, and timestamps without original content after retention expires
- [x] Administrators can clear Chat moderation records through a confirmed action
- [x] Current Admin and Owner badges update when current authority changes and are not stored as message history
- [x] Authorization tests cover every creation and reversal edge between administrators, Channel owners, and ordinary participants
- [x] Integration tests cover indefinite enforcement, reconnect state, reversal, authority restoration, and durable record history
- [x] Browser tests cover Chat ban, the active-restriction panel, allowed and rejected reversal, and the administrator record list


## Comments

- 2026-09-16: Implemented indefinite Chat bans, active restriction management, reversal, and paged administrator moderation history. Clearing records preserves active restrictions. Current authority badges refresh without a page reload.
- Validation passed: `npm run lint`, `npm run typecheck`, `npm test` with 44 files and 312 tests, and `npm run build -- --webpack`.
- Browser validation passed: all four scenarios selected by `--project=chat-chromium --grep 'Chat timeout|manages Chat bans'`. These cover all timeout presets, bans, reconnect state, allowed and rejected reversal, authority restoration, current badges, history pagination, and confirmed clearing. A temporary Playwright configuration used server readiness output because this environment times out on unused IPv4 ports before server startup.
- A SQLite upgrade check preserved an existing administrator timeout through migration 006 and record clearing. Foreign-key and integrity checks passed.
- Astra at medium effort reviewed Standards and Spec separately. The Standards review found duplicated HTTP handling; the endpoint now uses the shared helpers, and the reviewer confirmed the fix. The Spec review found no actionable issue.
