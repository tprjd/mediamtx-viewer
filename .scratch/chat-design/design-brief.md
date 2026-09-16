# Chat design brief

Status: Variant A selected. Settings, badge explanations, and moderation mockup available for review.

## Goal

Improve the overall appearance and readability of Chat with a compact, Twitch-style layout. Desktop and mobile are both primary uses.

## Accepted design

- Display the participant's name and Chat message on the same line. Long messages wrap below.
- Use consistent colors for participant names and slightly larger message text.
- Use no message bubbles.
- Keep the app's existing color palette around the messages.
- Place small role badges before the participant's name.
- Explain each role badge on hover or keyboard focus. Touch users can tap the badge.
- Keep a subdued Chat author tag beside the name to distinguish participants with the same display name.
- Provide a Chat settings menu with a Show timestamps toggle. When enabled, the time appears before each message.
- Place mobile Chat below the video in portrait and beside the video in landscape.
- Provide a clear control to show or hide Chat.
- Redesign the Chat header, message list, message input, and status notices together.
- Remove the empty red status strip and make the message input spacing consistent.

## Existing constraints

Chat author tags and role badges retain their meanings from [CONTEXT.md](../../CONTEXT.md).
Public author information follows [ADR 0004](../../docs/adr/0004-protect-chat-author-identifiers.md).

The design covers existing message history, new-message navigation, message submission states, and moderation controls.
Status notices include connection loss, sending limits, Chat restrictions, and unavailable Chat.
Keyboard access, focus behavior, and text selection remain part of the interaction design.

## Visual prototype

The browser prototype is on branch `prototype/chat-design`.
The implementation issue is [01: Implement the selected Chat design](issues/01-implement-selected-chat-design.md).
Exact spacing, font sizes, colors, badge appearance, and responsive dimensions remain subject to prototype feedback.

The prototype has three variants on the existing watch route:

- `?variant=A`: Selected compact feed with a top header, Chat settings, and inline Send button.
- `?variant=B`: Messages grouped by minute, with a larger room summary and a separate Send row.
- `?variant=C`: Side controls, an open transcript, and room information above the message input.

The floating bar changes the variant and sample state. The arrow keys also change the variant outside text inputs and other interactive controls.
Sample messages and moderation actions stay in browser memory. Reloading restores the sample conversation.
The timestamp setting also stays in memory and starts off after a reload.
The Moderator control previews the Channel owner's moderation tools.
Message menus open removal, timeout, ban, and retained-content dialogs.
Timeout and ban forms use the existing duration and category choices. Other requires a private note.
The header's shield button opens active restrictions and supports lifting a timeout or ban.
Actions use Chat author tags to distinguish participants with matching display names.
The launcher creates a temporary database for sample Channels and removes it when the server stops.
The prototype is disabled in production builds.

The prototype review covers these cases:

- Desktop Chat beside the video, including theater mode.
- Mobile Chat in portrait and landscape, including theater mode.
- Short messages, long messages, long names, and matching display names with different Chat author tags.
- Role badges, moderation controls, and removed messages.
- Timestamp settings and badge explanations by pointer, keyboard, and touch.
- Message input, an empty Chat room, connection notices, and failed submissions.
- Older history and the control that returns to new messages.

## Decision record

The user accepted all recommendations in interview questions 4 through 7.
The user then selected A and requested a timestamp setting, badge explanations, and a moderation mockup.
The timestamp setting replaces the earlier proposal to show each message's time on hover.
These additions are available in the local prototype. Production Chat remains unchanged.
