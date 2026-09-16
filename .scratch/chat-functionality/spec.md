# Spec: Channel Chat

Status: ready-for-agent

This specification records the agreed requirements. The linked implementation tickets below track progress. The [16 September 2026 rollout record](../../docs/chat-capacity/2026-09-16/README.md) documents the deployment exception to the original capacity requirements. The standard rollout gates remain unchanged.

## Problem Statement

The live watch page reserves space for Chat, but the panel is only a placeholder. A viewer cannot talk to other viewers, recover recent conversation after a reconnect, or ask a Channel owner to handle disruptive messages.

The first Chat release must fit the private account model and the current Oracle VM. Chat must not reduce playback reliability. It also needs enough moderation, retention, and recovery behavior to run safely from its first enabled release.

## Solution

Replace the placeholder with one live-only Chat room for each Channel. Every active account can read and send plain-text Chat messages while that Channel is live. The Chat room keeps its identity when publishing stops or restarts, and it exposes up to seven days of recent history during the next live period.

Run Centrifugo beside the viewer in the current Docker Compose deployment. Centrifugo owns authenticated WebSocket connections and live event delivery. Next.js owns account checks, message submission, validation, rate limits, moderation, and durable history in a separate SQLite database.

Keep the current desktop, narrow-screen, and theater-mode Chat layout. Add paged history, safe optimistic sending, reconnect recovery, accessible message announcements, and moderator controls. Release the feature behind a global disabled-by-default flag. Enable it only after the real-stack, restore, and live-stream capacity checks pass.

## User Stories

1. As a viewer, I want each Channel to have one Chat room, so that I can join the conversation for the Channel that I watch.
2. As a viewer, I want the same Chat room after publishing restarts, so that a brief interruption does not create a different conversation.
3. As a viewer, I want Chat only while the Channel is live, so that the site does not create unmonitored offline rooms.
4. As a viewer, I want Chat hidden while the Channel is offline or unavailable, so that the watch page does not show an unusable panel.
5. As an active account holder, I want to read Chat, so that I can follow the live conversation.
6. As an active account holder, I want to send Chat messages, so that I can participate in the live conversation.
7. As a pending account holder, I want Chat to reject my access, so that Chat follows the existing account activation rules.
8. As a disabled account holder, I want Chat to revoke my access immediately, so that account disablement has one meaning across the site.
9. As an administrator, I want Chat to disconnect a disabled account's live connections, so that a deleted session cannot leave Chat access open.
10. As a viewer, I want every live Channel to use the same Chat policy, so that behavior does not change when I switch Channels.
11. As a Channel owner, I want Chat to require no per-Channel setup, so that a live Channel receives Chat when the site enables the feature.
12. As an administrator, I want one global Chat flag, so that I can enable or disable the feature for all Channels.
13. As a viewer, I want the existing placeholder when Chat is disabled, so that the watch layout remains complete during rollout or rollback.
14. As a viewer, I want Chat failure to leave playback available, so that conversation cannot interrupt the primary service.
15. As a Chat participant, I want to send a single-line plain-text message, so that the first release supports direct conversation.
16. As a Chat participant, I want messages limited to 500 visible Unicode characters, so that one message cannot dominate the room.
17. As a Chat participant, I want emoji and combined characters counted as visible characters, so that the limit matches what I see.
18. As a Chat participant, I want outside whitespace removed and line breaks replaced with spaces, so that messages have a consistent shape.
19. As a Chat participant, I want empty and control-only messages rejected, so that Chat does not contain invisible entries.
20. As a Chat participant, I want URLs to remain plain text, so that the first release does not create clickable phishing links.
21. As a Chat participant, I want the server to limit me to five messages per ten seconds with a burst of three, so that one account cannot flood a room.
22. As a Chat participant, I want the sending limit shared across my tabs for one room, so that opening more tabs cannot bypass it.
23. As a rate-limited Chat participant, I want to see when I can send again, so that the rejection is clear.
24. As a rate-limited Chat participant, I want Chat to keep my unsent text, so that I can revise or send it later.
25. As a rate-limited Chat participant, I do not want Chat to queue an automatic retry, so that old messages do not appear later without another action.
26. As a Chat participant, I want my message to appear with a Sending state at once, so that the composer feels responsive.
27. As a Chat participant, I want a failed message to keep a Retry action, so that a temporary request failure does not destroy my text.
28. As a Chat participant, I want Retry to reuse the original submission identity, so that it cannot create duplicate messages.
29. As a Chat participant, I want the server to accept a message only after durable storage succeeds, so that an accepted message survives a realtime delivery failure.
30. As a Chat participant, I want a delayed message marked clearly, so that I know when live delivery is waiting for recovery.
31. As a Chat participant, I do not want to edit or remove a sent message, so that the live transcript remains reliable for moderation.
32. As a Chat participant, I want each room to show one stable message order, so that reconnects do not rearrange the conversation.
33. As a Chat participant, I want Chat to remove duplicate events after a reconnect or Retry, so that each accepted message appears once.
34. As a Chat participant, I want each message to show my local time, so that I know when it was sent.
35. As a Chat participant, I want date separators between days, so that seven-day history remains understandable.
36. As a screen-reader user, I want the exact server timestamp available, so that I receive the same time information as a sighted participant.
37. As a Chat participant, I want the latest 100 visible messages when I open Chat, so that I receive useful context without a large first response.
38. As a Chat participant, I want upward scrolling to load 100 older messages at a time, so that I can inspect retained history.
39. As a Chat participant, I want my scroll position preserved when older messages load, so that the transcript does not jump.
40. As a Chat participant, I want a clear end marker at the seven-day history boundary, so that I know no older Chat content is available.
41. As a Chat participant, I want a virtualized message list, so that many loaded pages do not make the browser slow.
42. As a Chat participant reading older history, I want new messages to leave my scroll position unchanged, so that I can finish reading.
43. As a Chat participant reading older history, I want a New messages control, so that I can return to the current conversation.
44. As a Chat participant at the bottom, I want new messages to remain in view, so that I can follow the live conversation.
45. As a viewer, I want Chat to keep the existing right-side desktop panel, so that video and conversation remain visible together.
46. As a viewer, I want Chat below the player on a narrow screen, so that Chat does not squeeze the video.
47. As a mobile viewer, I want below-player Chat collapsed at first, so that video and Channel details appear before conversation.
48. As a viewer in theater mode, I want Chat to keep the existing theater layout and restore controls, so that Chat does not weaken the focused viewing mode.
49. As a viewer, I want closing Chat to release its width to the player, so that the page does not keep an empty column.
50. As a viewer, I want a closed or collapsed Chat to disconnect from Centrifugo, so that an invisible panel does not consume a live connection.
51. As a viewer, I do not want unread counts in the first release, so that closing Chat has no hidden notification behavior.
52. As a viewer, I want reopened Chat to fetch the current messages and start at the bottom, so that I rejoin the current conversation.
53. As a viewer, I do not want Chat to restore an old scroll position after it was closed, so that stale context does not replace the live view.
54. As a Chat participant, I want an unsent draft kept while I close and reopen Chat on the same Channel, so that a temporary close does not discard my text.
55. As a Chat participant, I want a draft cleared on page reload or Channel navigation, so that private text does not remain in browser storage.
56. As a keyboard user, I want an explicit Open Chat action to focus the composer, so that I can start typing without another navigation step.
57. As a keyboard user, I do not want initial page load to focus Chat, so that Chat does not steal control from playback.
58. As a keyboard user, I want closing Chat to return focus to its restore control, so that focus remains predictable.
59. As a Chat moderator, I want a closed moderation menu to return focus to its message action, so that I do not lose my place.
60. As a Chat participant, I want player shortcuts disabled while the composer has focus, so that typing cannot pause, mute, or resize playback.
61. As a Chat participant, I want Enter to send only when input-method composition is inactive, so that composing text cannot submit early.
62. As a screen-reader user, I want Chat to expose an accessible message log, so that I can follow new messages.
63. As a screen-reader user, I want Chat to announce new messages only while the visible log is at the bottom, so that older history remains readable.
64. As a screen-reader user, I do not want fetched history announced, so that loading one page does not read 100 messages aloud.
65. As a Chat participant, I want my displayed profile name captured when I send, so that a later profile rename does not rewrite history.
66. As a Chat participant, I want each author to have a stable room-specific Chat author tag, so that identical profile names remain distinguishable.
67. As a Chat participant, I do not want Chat to expose my username, email, or raw account ID, so that public conversation does not reveal account data.
68. As a Chat participant, I want colliding four-character Chat author tags extended until unique, so that every visible author remains distinct.
69. As a viewer, I want current Admin and Owner badges on messages, so that I can identify current Chat moderators.
70. As a former administrator or Channel owner, I do not want old messages to retain a stale authority badge, so that badges reflect current authority.
71. As a Channel owner, I want to remove a Chat message in my room, so that I can handle harmful content.
72. As a Channel owner, I want to apply a 10-minute, 1-hour, or 24-hour Chat timeout in my room, so that I can stop temporary disruption.
73. As a Channel owner, I want to apply a Chat ban in my room, so that I can stop repeated disruption until an authorized moderator lifts it.
74. As an administrator, I want to moderate every Chat room, so that I can enforce site-wide control.
75. As an administrator, I want to moderate a Channel owner, so that Channel ownership does not override administration.
76. As an administrator, I want my Chat messages and account immune to Channel-owner restrictions, so that a Channel owner cannot remove site control.
77. As an administrator, I want my restriction of a Channel owner to suspend that owner's Chat moderation authority, so that the restricted owner cannot keep controlling the room.
78. As a Chat participant with a Chat timeout or Chat ban, I want to keep Viewing access, so that a Chat restriction does not become an account restriction.
79. As a restricted Chat participant, I want the composer disabled with the category and duration, so that I know why I cannot send.
80. As a restricted Chat participant, I do not want the moderator's identity or private note exposed, so that private moderation data stays private.
81. As a Chat moderator, I want a restriction to remove that participant's messages from the previous ten minutes, so that I can clear an active spam incident.
82. As a viewer, I want removed messages replaced by content-free tombstones, so that I can understand gaps in the transcript.
83. As a viewer, I do not want Chat timeouts or Chat bans announced publicly, so that moderation does not become room entertainment.
84. As a Chat moderator, I want original removed content available for seven days, so that I can review recent evidence.
85. As a Chat moderator, I want to choose Spam, Harassment, or Other as the action category, so that the Chat moderation record has a consistent reason.
86. As a Chat moderator, I want an optional private note for Spam or Harassment, so that I can record useful context.
87. As a Chat moderator, I want Other to require a private note, so that the category is not empty.
88. As a Channel owner, I want to reverse Channel-owner actions in my room, so that I can correct a mistake.
89. As a Channel owner, I do not want to reverse an administrator's action, so that site control remains effective.
90. As an administrator, I want to reverse any Chat moderation action, so that I can resolve mistakes or changed circumstances.
91. As a Chat moderator, I want message actions available from the message itself, so that I can respond during an incident.
92. As a Chat moderator, I want a room panel for active Chat timeouts and Chat bans, so that I can review and lift restrictions.
93. As an administrator, I want a durable Chat moderation record list, so that I can review who acted, against whom, when, and why.
94. As an administrator, I want moderation action records kept until I clear them, so that accountability outlives the seven-day transcript.
95. As a Chat participant, I want original message content and private moderation notes removed after seven days, so that the moderation record does not become a hidden transcript.
96. As a Chat participant, I want Chat to reconnect after a brief network change without a page reload, so that playback continues.
97. As a Chat participant, I want Chat to recover recent events from Centrifugo after a short disconnect, so that recovery avoids an unnecessary history request.
98. As a Chat participant, I want Chat to reconcile with SQLite when Centrifugo cannot recover a gap, so that the transcript becomes complete.
99. As a Chat participant, I want Chat to show loaded history during a Centrifugo outage, so that a transport failure does not erase the panel.
100. As a Chat participant, I want Chat to accept durable messages during a Centrifugo outage, so that live delivery can catch up after recovery.
101. As a Chat participant, I want Chat to show Reconnecting during a Centrifugo outage, so that delayed delivery is clear.
102. As a Chat participant, I want Chat to disable sending when the Chat database is unavailable, so that the interface does not claim to save a message.
103. As a Chat participant, I want loaded messages to remain visible during a Chat database failure, so that the panel stays stable.
104. As an administrator, I want Chat health reported as degraded without failing core viewer health, so that service monitoring does not restart working playback.
105. As an administrator, I want a Centrifugo container health check, so that the deployment reports the failed service.
106. As an administrator, I want a sustained Chat outage or disk threshold shown on the Statistics page, so that I can inspect the problem.
107. As an administrator, I want one Discord alert after five minutes of sustained failure, so that I learn about the problem without repeated messages.
108. As an administrator, I want one recovery alert, so that I know when Chat returns.
109. As an administrator, I want Chat logs to exclude message content, names, notes, tokens, cookies, and idempotency keys, so that logs do not become another data store.
110. As an administrator, I want new Chat message submissions to stop before storage threatens the host, so that authentication, Channel status, and playback keep working.
111. As an administrator, I want Chat history to remain readable after the write threshold, so that existing retained data remains useful.
112. As an administrator, I want hourly and startup retention cleanup, so that downtime does not extend the seven-day policy.
113. As an administrator, I want retention cleanup before backup and after restore, so that expired Chat content does not reappear.
114. As an administrator, I want one daily encrypted backup set for both databases, so that Chat and authentication have a recorded recovery point.
115. As an administrator, I want separate database backup files with a shared identifier and manifest, so that I can restore either database alone.
116. As an administrator, I want seven daily backup sets retained, so that backup storage follows the Chat retention period.
117. As an administrator, I want a tested independent Chat restore, so that Chat recovery cannot require an authentication rollback.
118. As a viewer, I want Chat rollout and rollback to avoid a page or database rollback, so that playback remains available during deployment changes.
119. As an administrator, I want the release to support 100 connected Chat clients and ten accepted messages per second for 15 minutes, so that the current VM has a measured limit.
120. As a viewer, I want live Chat delivery within one second at the tested load, so that conversation remains timely.
121. As a viewer, I want message submission and history pages within their tested latency limits, so that Chat remains responsive.
122. As a viewer, I want Chat reconnect and reconciliation within five seconds, so that a short deployment or network break ends without manual action.
123. As a viewer, I want the load test to leave playback and Channel status unchanged, so that Chat proves that it is secondary to streaming.

## Implementation Decisions

### Scope and access

- One Chat room belongs to one Channel. Use the stable internal Channel identifier, not a user-controlled slug, as the storage and delivery key.
- The Chat room keeps its identity across publishing stops and restarts.
- Show and connect Chat only while the server reports that the Channel is live. When the Channel becomes offline or unavailable, hide Chat and close its connection.
- The send endpoint checks current server-side Channel state before it starts the database transaction. Reject a send if the Channel is already offline. Keep a message that committed immediately before the offline transition.
- Every active account can read and send. Pending and disabled accounts cannot connect, load history, or send.
- The global `CHAT_ENABLED` flag controls every Channel. The flag defaults to disabled.
- The first release has no per-Channel Chat switch and no room-specific policy.

### Message rules

- Accept single-line plain text only.
- Limit content to 500 Unicode grapheme clusters after normalization.
- Normalize Unicode to one documented form. Trim outside whitespace, replace line breaks with spaces, and reject empty or control-only content.
- Render content as text. Do not create clickable links or rich previews.
- Chat messages are immutable. A Chat participant cannot edit or remove a sent message.
- Limit one account in one room to five messages in ten seconds with a burst of three. Aggregate the limit across tabs and connections.
- Return a retry time when the rate limit rejects a send. Keep the draft and disable Send with a visible countdown. Do not queue an automatic retry.
- Give every submission a client idempotency key. A manual Retry reuses the same key.
- Give public transcript changes a per-room increasing sequence and a server timestamp.
- Display local time on every message. Add date separators between local calendar days. Keep the exact server timestamp available to assistive technology.

### History and scrolling

- Keep visible Chat messages for seven days.
- Load the latest 100 visible entries when Chat opens.
- Load older entries in pages of 100 when the participant scrolls upward. Use a cursor based on the stable room sequence.
- Preserve the viewport anchor when an older page arrives.
- Show an end marker when the query reaches the seven-day boundary.
- Use a virtualized list so fetched history does not create an unbounded document tree.
- Follow new messages while the participant is at the bottom.
- If the participant reads older history, keep the current position and show a New messages control.
- A reopened Chat fetches the latest messages and starts at the bottom. Do not restore the previous scroll position or add an unread count.

### Author identity

- Store the stable account ID internally and snapshot the profile name on each Chat message.
- Do not expose the login username, email, or raw account ID in a Chat response or event.
- Derive a stable four-character Chat author tag from a keyed hash of the account ID and room ID.
- If a new participant's four-character tag collides in a room, extend only that participant's tag until it is unique.
- Keep the dedicated tag HMAC secret stable. Rotate it only when an intentional tag reset is acceptable.
- Show the profile-name snapshot and Chat author tag on each message.
- Show current Admin and Owner badges. Resolve authority when the server prepares a response instead of storing historical badges with a message.

### Moderation

- An administrator is a Chat moderator for every room. A Channel owner is a Chat moderator only for their room.
- A Channel owner cannot moderate an administrator. An administrator can moderate a Channel owner.
- An administrator's Chat restriction of a Channel owner also suspends that owner's Chat moderation authority. It does not change Streaming access.
- Support Message removal, Chat timeouts of 10 minutes, 1 hour, and 24 hours, and indefinite Chat bans.
- A Chat timeout or Chat ban prevents sending but does not remove Viewing access.
- Applying a Chat timeout or Chat ban also applies Message removal to the target's messages from the previous ten minutes.
- Message removal replaces the public entry with a tombstone that contains no author or message content.
- Do not publish Chat timeout or Chat ban announcements to the room.
- Send restriction changes to the affected participant through a private control subscription. Show the category and remaining duration in the disabled composer. Do not show the moderator identity or private note.
- Require Spam, Harassment, or Other as the action category. A private note is optional for Spam and Harassment. Other requires a private note.
- Keep original removed content available only to current Chat moderators for seven days.
- A Channel owner can reverse only an action that a Channel owner made in that room.
- An administrator can reverse any Chat moderation action.
- Put remove, timeout, and ban commands in an accessible menu on each eligible message.
- Provide a room panel for active restrictions and reversal.
- Provide administrators with a paged Chat moderation record list.
- Keep each Chat moderation record until an administrator clears it. Keep the action, category, actor, target, room, and timestamps after content retention expires.
- Delete original content and private moderation notes after seven days.

### Client interaction

- Keep the current pinned desktop panel, narrow-screen disclosure, close and restore controls, and theater-mode placement.
- Open a Centrifugo connection only while Chat content is visible.
- Preserve an unsent draft in memory while Chat closes and reopens on the same Channel.
- Clear the draft on page reload or Channel navigation. Do not store drafts in browser storage.
- Show an optimistic message with a Sending state while its HTTP request is pending.
- On success, reconcile the optimistic entry with the server message and deduplicate the Centrifugo event.
- On failure, keep the entry with an error and Retry action.
- When an explicit Open Chat action runs, focus the composer. Do not focus Chat on initial page load.
- When Chat closes, return focus to its restore control.
- When a moderation menu closes, return focus to the action for that message.
- While the composer has focus, stop player keyboard shortcuts. Enter sends only when input-method composition is inactive.
- Expose the transcript as an accessible log.
- Announce new messages only when Chat is visible and at the bottom. Do not announce fetched history or new messages received while the participant reads older history.

### Realtime delivery

- Run one pinned ARM64-compatible Centrifugo image in the current Docker Compose stack.
- Keep Caddy as the only public entry point. Add the protected WebSocket route without exposing a new host port.
- Issue five-minute Centrifugo connection tokens through an authenticated Next.js endpoint.
- Give each visible Chat connection server-side subscriptions to the current room transcript and the participant's private control channel.
- Do not let browser clients select arbitrary Centrifugo channels or publish directly.
- Send messages and moderation commands to authenticated Next.js HTTP endpoints.
- Keep account checks, Channel checks, message rules, rate limits, moderation authorization, and persistence in Next.js.
- Use the Centrifugo single-node memory engine. Do not add Redis for the first release.
- Configure stream recovery for up to 300 publications and 30 seconds.
- Treat SQLite and the room sequence as the correctness authority. If Centrifugo cannot recover or the client detects a sequence gap, load the missing range from SQLite.
- Publish public message and tombstone events through the room sequence.
- Publish private restriction state through the participant-specific control channel.
- Disconnect all Centrifugo clients for an account when an administrator disables that account.
- Refresh expired tokens through the active Better Auth session.

### Durable delivery

- Use a separate `chat.sqlite` database for messages, room sequences, restrictions, moderation records, rate-limit state, and delivery outbox entries.
- Keep `auth.sqlite` as the authentication database.
- Store account and Channel IDs as application-validated references. Do not create cross-database foreign keys.
- Use WAL mode, foreign-key checks within the Chat schema, a busy timeout, and bounded transactions.
- Commit the Chat message and its outbox event in one transaction.
- Return success only after the transaction commits.
- Let an outbox dispatcher publish committed events to Centrifugo and retry transient failures.
- Use a stable Centrifugo publication idempotency key for outbox Retry.
- Let clients deduplicate publications by application message identity and room sequence.
- During a Centrifugo outage, keep history visible and continue to accept durable sends. Show Reconnecting and mark affected optimistic entries as delayed.

### Retention, backup, and disk safety

- Delete Chat messages, original removed content, and private moderation notes after seven days.
- Run retention cleanup on startup, once per hour, before backup, and immediately after restore.
- Keep structured Chat moderation records until an administrator clears them.
- Back up `auth.sqlite` and `chat.sqlite` separately in one daily job.
- Give both encrypted backup files one shared backup identifier and manifest.
- Keep seven daily backup sets.
- Permit independent restore of either database.
- After a Chat restore, purge expired content before Chat becomes available.
- Stop new Chat message submissions when `chat.sqlite` reaches 2 GiB or its filesystem has less than 10 GiB free, whichever happens first.
- Make both disk thresholds configurable.
- At a disk threshold, keep retained history readable. Keep account access, Channel status, and playback operational.
- Treat 100,000 messages per day across the site as the normal storage budget. Treat ten messages per second as the tested peak, not a seven-day sustained rate.

### Health, alerts, and privacy

- Keep the main health endpoint successful when core viewing works. Add a Chat component state that can report disabled, healthy, degraded, or unavailable.
- Add a separate Centrifugo container health check.
- If `chat.sqlite` is unavailable, keep already loaded messages visible and disable the composer and moderation controls.
- Show a sustained Chat outage or disk threshold on the Statistics page.
- After five minutes of sustained failure, send one deduplicated Discord alert. Send one recovery alert when the condition clears.
- Log event type, opaque identifiers, result, duration, outbox queue depth, and error codes.
- Do not log message content, profile names, private notes, tokens, cookies, or client idempotency keys.
- Keep Chat failures out of playback selection, playback runs, transport recovery, and the Streaming contract.

### Rollout and capacity

- Keep Chat disabled until database migrations, Centrifugo health, automated tests, the restore drill, and the live-stream capacity test pass.
- Disabling Chat restores the placeholder and stops Chat connections. It does not delete Chat data or roll back the schema.
- Test 100 connected Chat clients and ten accepted messages per second for 15 minutes while a real Channel is live.
- Require message submission p95 at or below 500 milliseconds.
- Require live delivery p95 at or below 1 second.
- Require a 100-message history page p95 at or below 1 second.
- Require reconnect and reconciliation within 5 seconds.
- During the capacity test, require the playback browser to avoid Chat-induced playback recovery or fallback.
- During the capacity test, require Channel status updates to keep their existing timing.
- After the test, require the viewer, Centrifugo, SQLite, and host to return to healthy steady state.

## Testing Decisions

- Good tests assert behavior at a public boundary. They do not assert component state, private helper calls, CSS class names, or the internal structure of a Centrifugo client.
- Prefer one high browser seam for the participant experience. Run an authenticated watch page against Next.js, the Chat database, and Centrifugo. Control Channel live state through the existing status seam.
- Extend the current watch-page browser tests. They already cover Chat placement, open and closed preference, narrow layout, theater mode, focus, and player width.
- Keep focused component tests for states that are costly to arrange through the full stack. Cover offline and unavailable Channels, a restricted participant, database failure, delayed delivery, rate-limit countdown, tombstones, and moderator menus.
- Add pure rule tests for Unicode normalization, grapheme counting, whitespace handling, empty input, rate-limit decisions, moderation authority, reversal authority, timeout expiry, and author-tag collision handling.
- Add SQLite integration tests for message and outbox atomicity, idempotent Retry, per-room sequencing, cursor pagination, concurrent sends, restrictions, ten-minute Message removal, retention cleanup, disk-write refusal, and independent database failure.
- Add authenticated HTTP integration tests for active, pending, and disabled accounts. Cover stale browser state when a Channel becomes offline.
- Add authorization tests that prove a Channel owner cannot moderate an administrator or reverse an administrator action.
- Add tests that prove an administrator restriction suspends a Channel owner's Chat moderation authority without changing Streaming access.
- Add response-shape tests that reject username, email, raw account ID, original removed content, and private moderation notes at participant boundaries.
- Add log-capture tests that reject Chat content, profile names, secrets, and idempotency keys in operational logs.
- Run a pinned real Centrifugo container in an integration test. Verify connection-token validation, server-side subscriptions, blocked direct publication, short recovery, failed recovery, reconnect, personal control events, and account disconnect.
- Verify that room-sequence reconciliation repairs a lost or expired Centrifugo stream.
- Verify that a Centrifugo restart does not reload the watch page or interrupt playback.
- Add browser tests for optimistic send success, failed send Retry, delayed delivery, duplicate suppression, automatic scrolling, upward pagination, viewport anchoring, virtualization, New messages behavior, and reopen-at-bottom behavior.
- Add browser tests for Enter submission, input-method composition, player-shortcut isolation, draft lifecycle, focus return, and accessible-log announcements.
- Add browser tests for current Admin and Owner badges after authority changes.
- Add browser tests for Message removal, every timeout preset, Chat ban, required Other notes, affected-participant feedback, automatic ten-minute tombstones, active-restriction management, and allowed reversal.
- Add backup tests that create one shared manifest and two encrypted database files. Verify seven-set rotation and independent restore.
- Run the restore drill before enabling Chat. Restore only `chat.sqlite`, purge expired content, reconnect Centrifugo, and prove that authentication and playback remain available.
- Add health and alert tests. Verify degraded main health, Centrifugo health, Statistics warnings, the five-minute alert delay, deduplication, and one recovery alert.
- Run the 15-minute capacity test on the current VM with a real live Channel. Record Chat latency, reconnect time, outbox depth, database size, free disk, CPU, memory, Channel status timing, and playback behavior.
- Existing authenticated SSE route tests are prior art for long-lived connection authentication, abort cleanup, heartbeat behavior, and no-buffer response headers.
- Existing authentication and Channel integration tests are prior art for active-account checks, role checks, ownership, SQLite migrations, and audit records.
- Existing playback-run and player browser tests remain the authority for proving that Chat does not change playback behavior.
- Do not replace the existing Vitest and Playwright tools. A small repository-owned load driver may use the selected Centrifugo client to create the agreed traffic.

## Out of Scope

- Offline Chat access or sending.
- Per-Channel Chat enablement.
- Per-room retention, rate, message, or moderation settings.
- Delegated Chat moderators or a new account role.
- Slow mode or restricted-participant room modes.
- Participant edits or removal of their own messages.
- Forced participant removal from a room while Viewing access remains active.
- Direct messages.
- Replies or conversation threads.
- Mentions.
- Reactions.
- Custom emotes.
- Presence and participant lists.
- Typing indicators.
- Unread counts.
- Participant-facing Chat notifications.
- Transcript search or export.
- Automated content filters.
- Participant reports or a moderation queue.
- Clickable links or rich previews.
- File, image, audio, or video attachments.
- Redis or more than one Centrifugo instance.
- A complete external Chat platform or a second account system.
- Changes to publishing, MediaMTX media transport, playback selection, playback runs, pause behavior, recovery eligibility, HLS timing, WebRTC behavior, or the Streaming contract.

## Further Notes

- The current watch page already contains the final desktop, narrow-screen, and theater-mode locations for Chat. Replace the placeholder inside that established layout.
- The current deployment uses one ARM VM with 1 OCPU, 6 GiB RAM, and a 50 GiB boot volume by default. Measure the live host before enabling another container.
- Pin the exact Centrifugo image version that passes ARM64 and real-stack verification.
- Store Centrifugo keys, the author-tag HMAC secret, and any new internal API secret with the existing encrypted deployment secrets.
- Keep the Caddy route same-origin and unbuffered where the selected transport requires it. Do not expose Centrifugo directly through a host port.
- The implementation uses ten tickets. Each ticket records its dependencies:
  1. [Send and reload a Chat message](issues/01-send-and-reload-chat-message.md).
  2. [Receive live Chat messages](issues/02-receive-live-chat-messages.md).
  3. [Browse retained Chat history](issues/03-browse-retained-chat-history.md).
  4. [Handle Chat sending limits and failures](issues/04-handle-chat-sending-limits-and-failures.md).
  5. [Remove harmful Chat messages](issues/05-remove-harmful-chat-messages.md).
  6. [Apply and enforce Chat timeouts](issues/06-apply-and-enforce-chat-timeouts.md).
  7. [Manage Chat bans and moderation history](issues/07-manage-chat-bans-and-moderation-history.md).
  8. [Degrade Chat without harming viewing](issues/08-degrade-chat-without-harming-viewing.md).
  9. [Back up and restore Chat](issues/09-back-up-and-restore-chat.md).
  10. [Prove capacity and enable guarded rollout](issues/10-prove-capacity-and-enable-guarded-rollout.md).
- Chat stays disabled until every ticket is complete and the release gates pass.
