# Review the registration and access frontend before implementation

Type: prototype
Status: resolved

## Question

Which layout makes registration, channel approval, owner notifications, and recovery
clear across viewer, owner, and administrator screens?

## Primary source

- Branch: `codex/prototype-open-registration`
- Captured commit: `31f8348`
- Local preview: [open prototype](http://127.0.0.1:3100/prototype/registration?variant=A)
- Route: `/prototype/registration?variant=A`
- Start command: `npm run prototype:registration`
- Source and walkthrough: [prototype README](/Users/david/.codex/worktrees/registration-ui-prototype/mediamtx-viewer/app/prototype/registration/README.md)
- Variants: A, Familiar; B, Side by side; C, Workspace.

## Verdict

The user selected A for the access flows. Keep the current application layout and existing controls; do not use the prototype as a replacement design.
The prototype exercises the confirmed design using in-memory data. It is not the
production implementation and does not validate real access enforcement or SMTP.

## Implementation follow-up

Use the chosen layouts when implementing the confirmed access guide and design spec.
Keep real server authorization, stored approvals, notifications, and SMTP delivery
separate from this throwaway code. Do not merge the demo state or preview controls.

## Verification

- Type checking, repository lint, and production build passed.
- Browser walkthroughs covered request, approval, playback/chat access, revocation,
  the 30-minute retry delay, silent notification delivery, registration, verification,
  password recovery, administrator approval, and suspension.
- All 12 screens rendered in each of the three variants at an effective 300 CSS-pixel
  viewport, with no document-level horizontal overflow.
- Desktop variants and the header notification dialog were inspected visually.

## Comments

The local branch has no configured upstream. Delivery remains local unless an
upstream is configured in a later task. The preview server is left running for review.
