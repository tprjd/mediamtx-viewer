# 05: Remove harmful Chat messages

**What to build:** Let a Channel owner or administrator remove one harmful Chat message and replace it with a content-free tombstone for every participant.

**Blocked by:** 02: Receive live Chat messages; 03: Browse retained Chat history

**Status:** resolved

- [x] A Channel owner can remove a message only in their own Chat room
- [x] An administrator can remove a message in any Chat room
- [x] A Channel owner cannot remove an administrator's message
- [x] An accessible message menu offers Message removal only when the current participant has authority
- [x] Closing the message menu returns focus to that message's action
- [x] The moderator selects Spam, Harassment, or Other before confirming Message removal
- [x] A private note is optional for Spam and Harassment
- [x] Other requires a non-empty private note
- [x] Message removal commits the tombstone state, the Chat moderation record, and the outbox event atomically
- [x] The room publishes the tombstone through the public transcript sequence
- [x] Every connected participant replaces the message with a tombstone without a reload
- [x] The tombstone contains no original author name, Chat author tag, or message content
- [x] History pagination returns the tombstone instead of the original participant content
- [x] Current Chat moderators can inspect original content while the system retains it
- [x] Ordinary participants cannot retrieve original content, the moderator identity, or the private note through any response or event
- [x] The room receives no separate public moderation announcement
- [x] The Chat moderation record stores the action, category, actor, target, room, and timestamps
- [x] Authorization tests cover administrator, Channel owner, ordinary participant, wrong room, and administrator immunity
- [x] Integration tests cover atomic removal, realtime tombstone delivery, history redaction, and private moderation access
- [x] Browser tests cover the message menu, required Other note, focus return, and tombstone replacement

## Comments

- 2026-09-15: Implemented Message removal with atomic moderation records and outbox delivery, content-free tombstones, current-role authorization, private moderator inspection, and recovery-cache redaction.
- Validation passed: 44 Vitest files with 276 tests, ESLint, TypeScript type checking, the Webpack production build, and the retained-history and Message-removal browser scenarios against Next.js, SQLite, and Centrifugo.
- Standards and Spec reviews found no unresolved findings after fixes for inactive-administrator immunity and stale screen-reader announcements during recovery.
