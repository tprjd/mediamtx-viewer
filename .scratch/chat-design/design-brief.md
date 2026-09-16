# Chat design brief

Status: Design direction accepted by the user. Visual prototype available. Variant selection pending.

## Goal

Improve the overall appearance and readability of Chat with a compact, Twitch-style layout. Desktop and mobile are both primary uses.

## Accepted design

- Display the participant's name and Chat message on the same line. Long messages wrap below.
- Use consistent colors for participant names and slightly larger message text.
- Use no message bubbles.
- Keep the app's existing color palette around the messages.
- Place small role badges before the participant's name.
- Keep a subdued Chat author tag beside the name to distinguish participants with the same display name.
- Show timestamps on hover or keyboard focus. On touch screens, a tap can show the timestamp.
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

- `?variant=A`: Compact feed with a top header and inline Send button.
- `?variant=B`: Messages grouped by minute, with a larger room summary and a separate Send row.
- `?variant=C`: Side controls, an open transcript, and room information above the message input.

The floating bar changes the variant and sample state. The arrow keys also change the variant outside text inputs and other interactive controls.
Sample messages and moderation actions stay in browser memory. Reloading restores the sample conversation.
The launcher creates a temporary database for sample Channels and removes it when the server stops.
The prototype is disabled in production builds.

The prototype review covers these cases:

- Desktop Chat beside the video, including theater mode.
- Mobile Chat in portrait and landscape, including theater mode.
- Short messages, long messages, long names, and matching display names with different Chat author tags.
- Role badges, moderation controls, and removed messages.
- Timestamp access by pointer, keyboard, and touch.
- Message input, an empty Chat room, connection notices, and failed submissions.
- Older history and the control that returns to new messages.

## Decision record

The user accepted all recommendations in interview questions 4 through 7.
This brief records that agreement. It does not report an implemented or tested UI.
