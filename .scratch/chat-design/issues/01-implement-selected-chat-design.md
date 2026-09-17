# 01: Implement the selected Chat design

Status: resolved

## Design sources

- [Accepted design brief](../design-brief.md)
- [Local preview instructions](../preview.md)
- Prototype branch: `prototype/chat-design-reference` at `23f73b5`
- Prototype components: `components/chat-design-prototype.tsx`, `components/chat-design-prototype-controls.tsx`, `components/prototype-switcher.tsx`, and `components/chat-design-prototype.module.css`
- Host route: `/watch/[slug]?variant=A`, `B`, or `C`

## Question and verdict

Which message hierarchy and panel layout makes Chat clear beside video on desktop and mobile?

The user accepted compact messages, visible author tags, small role badges, optional timestamps, and portrait and landscape layouts.
The prototype compares a continuous feed, groups by minute, and a separate tools rail.
The user selected A, the compact feed.
The user requested a Chat settings menu that toggles timestamps before messages, role badge explanations, and a moderation mockup.
The refined prototype includes those additions. The user approved its design and requested production implementation.
The user accepted the functionality, then requested visual refinement focused on menus and moderation.
The latest prototype reduces dialog height, aligns related fields, separates ban actions, and uses compact restriction rows.

## Implementation scope after selection

Apply the selected design to the real Chat header, transcript, message input, and notices.
Include the timestamp setting and accessible badge explanations.
Use the prototype's moderation forms and restriction list as the visual reference.
Use the existing Chat delivery, history, access, and moderation behavior.
Keep author identity consistent with the [author privacy rules](../../../docs/chat-operations.md#author-privacy).
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

## Implementation decisions

The production timestamp setting starts off and persists in browser storage across reloads and Channels.
The prototype keeps its original in-memory setting on the reference branch.
The real moderation forms require a category selection, as before. Other also requires a private note.
The header shield uses the existing restriction list and reversal API.
The prototype route, sample components, and launcher are removed from the implementation branch.

## Comments

The user approved the menu and moderation design, then invoked `implement`.

## Production verification

- `npm run lint` and `npm run typecheck` pass.
- `npm test` passes all 339 tests in 52 files.
- The Chat browser suite and six affected watch-page checks pass, 23 tests total.
- The final layout check also passes at 768×390, including access to the Channel drawer. At 844×390, the Channel rail remains visible.
- Browser checks cover saved timestamps, keyboard and touch badge explanations, dialog validation, focus recovery, history position, live delivery, IME input, real moderation, and playback during Chat failures.
- Screenshots under `.data/chat-implementation-*` were inspected at desktop, portrait, landscape, and portrait theater sizes.
- `npm run build -- --webpack` passes. The default Turbopack build fails in this environment when its CSS worker tries to bind a port.
- Standards review: no remaining findings. Its browser-storage fallback finding was reproduced, fixed, and covered by a test.
- Spec review: no findings.

The current branch has no configured upstream. Delivery is a local commit; no push is attempted.
