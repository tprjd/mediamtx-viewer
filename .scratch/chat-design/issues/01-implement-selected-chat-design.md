# 01: Implement the selected Chat design

Status: needs-info
Blocked by: Review of the selected variant's settings and moderation mockup.

## Design sources

- [Accepted design brief](../design-brief.md)
- [Local preview instructions](../preview.md)
- Prototype branch: `prototype/chat-design`
- Prototype components: `components/chat-design-prototype.tsx`, `components/chat-design-prototype-controls.tsx`, `components/prototype-switcher.tsx`, and `components/chat-design-prototype.module.css`
- Host route: `/watch/[slug]?variant=A`, `B`, or `C`

## Question and verdict

Which message hierarchy and panel layout makes Chat clear beside video on desktop and mobile?

The user accepted compact messages, visible author tags, small role badges, optional timestamps, and portrait and landscape layouts.
The prototype compares a continuous feed, groups by minute, and a separate tools rail.
The user selected A, the compact feed.
The user requested a Chat settings menu that toggles timestamps before messages, role badge explanations, and a moderation mockup.
The refined prototype includes those additions. Production implementation remains pending.

## Implementation scope after selection

Apply the selected design to the real Chat header, transcript, message input, and notices.
Include the timestamp setting and accessible badge explanations.
Use the prototype's moderation forms and restriction list as the visual reference.
Use the existing Chat delivery, history, access, and moderation behavior.
Keep author identity consistent with ADR 0004.
Preserve keyboard access, touch access, text selection, focus recovery, and history scroll position.
Keep the prototype variants on the prototype branch. Production code must use the real Chat state and adapters.

## Prototype verification

Browser checks cover all variants at desktop 1440×1000, portrait 390×844, and landscape 844×390.
All nine layouts loaded without page errors or horizontal overflow.
Interaction checks cover local sending, URL switching and reload, text-input arrow keys, empty Chat, disabled sending, reconnect notices, retry, and sample removal.
Additional checks cover Chat visibility and focus, theater mode, the timestamp toggle, and role badge explanations by pointer, keyboard, and touch.
The refined moderation checks cover category validation, duplicate display names, removal confirmation and cancellation, timeout duration, ban, retained content, and lifting restrictions.
Browser checks also confirm focus recovery, administrator protection in the Channel owner preview, and mobile dialogs within the viewport.
The prototype makes no Chat mutation requests.

Lint and TypeScript checks pass. Screenshots are local artifacts under `.data/chat-prototype-*`.
