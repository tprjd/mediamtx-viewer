# 01: Implement the selected Chat design

Status: needs-info
Blocked by: User selection of a prototype variant or combination.

## Design sources

- [Accepted design brief](../design-brief.md)
- [Local preview instructions](../preview.md)
- Prototype branch: `prototype/chat-design`
- Prototype components: `components/chat-design-prototype.tsx`, `components/prototype-switcher.tsx`, and `components/chat-design-prototype.module.css`
- Host route: `/watch/[slug]?variant=A`, `B`, or `C`

## Question and verdict

Which message hierarchy and panel layout makes Chat clear beside video on desktop and mobile?

The user accepted compact messages, visible author tags, small role badges, optional timestamps, and portrait and landscape layouts.
The prototype compares a continuous feed, groups by minute, and a separate tools rail.
The preferred variant remains undecided. No production design has been selected.

## Implementation scope after selection

Apply the selected design to the real Chat header, transcript, message input, and notices.
Use the existing Chat delivery, history, access, and moderation behavior.
Keep author identity consistent with ADR 0004.
Preserve keyboard access, touch access, text selection, focus recovery, and history scroll position.
Keep the prototype variants on the prototype branch. Production code must use the real Chat state and adapters.

## Prototype verification

Browser checks cover all variants at desktop 1440×1000, portrait 390×844, and landscape 844×390.
All nine layouts loaded without page errors or horizontal overflow.
Interaction checks cover local sending, URL switching and reload, text-input arrow keys, empty Chat, disabled sending, reconnect notices, retry, and sample removal.
Additional checks cover Chat visibility and focus, theater mode, and timestamps by pointer, keyboard, and touch.
The prototype makes no Chat mutation requests.

Lint and TypeScript checks pass. Screenshots are local artifacts under `.data/chat-prototype-*`.
