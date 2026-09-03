# Plan: F hotkey toggles fullscreen (full default hotkey set, anywhere on watch page)

## Goal
On a channel's watch page, make the player's keyboard shortcuts work across the whole
page without first clicking/focusing the video. The user asked for the `f` key to toggle
fullscreen; after confirmation we make Vidstack's full default hotkey set active
(`f` fullscreen, `m` mute, `k`/`Space` play-pause, arrow keys volume).

## Decision
- Scope: **full default set**, working from anywhere on the page (user-confirmed).
- Mechanism: set `keyTarget="document"` on the shared Vidstack player.
- Deliverables: the one-line source change, the companion component test, and a
  design-record doc added to `docs/` (user asked to put this plan into the project docs).

## Why this is the right size/shape
- The video player is Vidstack (`@vidstack/react` 1.15.6), rendered by the shared
  `components/vidstack-player.tsx` and used by both `hls-player.tsx` and
  `webrtc-player.tsx` (one or the other per mode). So one prop change covers every
  playback mode.
- Vidstack **already** binds `toggleFullscreen: "f"` by default (verified in
  `node_modules/@vidstack/react/dev/chunks/…js`, `MEDIA_KEY_SHORTCUTS`). The only reason
  `f` does nothing today is that the default `keyTarget` is `"player"` — keys only
  register once the `<media-player>` element has focus.
- Vidstack's `keyTarget` documented values (verified in the type defs):
  - `document`: listen for events on the entire document; with multiple players only the
    most recently active player receives input (watch page has exactly one player).
  - `player` (default): listen only on the player / recently-interacted child.
- Safety checks (verified by inspection):
  - Exactly one `<media-player>` on the watch page (`LivePlayer` renders either
    `WebRtcPlayer` or `HlsPlayer`, both wrapping `VidstackPlayer`).
  - No text inputs on the watch page; Vidstack also ignores keys while `input/textarea/
    select/[contenteditable]` has focus, and treats `Space`/`Enter` on a focused button as
    a keyboard click (activating the button, not the video).
  - No app-level global keyboard handlers exist (searched `components`, `app`, `lib`), so
    nothing else consumes `f`/`m`/`k`/arrows.

## Change (source)
1. `components/vidstack-player.tsx` — on the `<MediaPlayer>` element, add the prop
   `keyTarget="document"` (alongside the existing `keyShortcuts={LIVE_KEY_SHORTCUTS}`,
   `liveEdgeTolerance`, etc.). This is the only source-code edit.

   Note: `LIVE_KEY_SHORTCUTS` already disables the live-inappropriate shortcuts
   (`seekBackward`, `seekForward`, `slowDown`, `speedUp`). Leave that object unchanged;
   `toggleFullscreen` is intentionally left to the default `"f"`.

## Tests
1. `components/vidstack-player.test.tsx` — the mocked `MediaPlayer` currently only reads a
   few props. Update the mock (and `mocks`) to capture the full props object it receives
   (e.g. `mocks.lastMediaPlayerProps = props` inside the mocked `MediaPlayer`), then add an
   assertion that `VidstackPlayer` passes `keyTarget="document"` to `MediaPlayer`.
   Reset `mocks.lastMediaPlayerProps` in `beforeEach`.

## Documentation
Create a design-record doc in `docs/` (the user asked to put this plan into the project
docs). Follow the house style of the existing `docs/*-plan.md` files (title, `Status:`,
short sections; no timing blockquote needed since no streaming-contract timing is
involved). There is no docs index or markdown linter to update.

1. New file `docs/player-keyboard-shortcuts-plan.md`. Contents to capture:
   - Title: `# Player keyboard shortcuts` and a one-line `Status:` line.
   - Feature summary: on a watch page the player's keyboard hotkeys work across the
     whole page without first focusing the video.
   - Hotkeys table: `F` fullscreen, `M` mute, `K`/`Space` play-pause, `ArrowUp`/`ArrowDown`
     volume; note that live-inappropriate shortcuts (seek, playback speed) stay disabled.
   - Decision: `VidstackPlayer` sets `keyTarget="document"` on the shared player so keys are
     handled document-wide; Vidstack's default shortcuts are used as-is (no custom
     bindings), and `F` was already bound to fullscreen by Vidstack.
   - Why it is safe: the watch page hosts exactly one player; the player ignores keys while
     an input/textarea/select/contenteditable has focus and treats Space/Enter on a focused
     button as a button activation; no app-level global key handlers exist.
   - Validation: component test asserts `keyTarget="document"`; `npm run typecheck`,
     `npm run lint`, `npm test`; manual check on a live channel.
2. Optional (discoverability): add one bullet to the README "## Features" section noting the
   player hotkeys (F fullscreen, M mute, K/Space play-pause, arrows volume) on the watch page.
   Keep it to one line; do not restructure the README.

## Validation
- `npm run typecheck` — confirm `keyTarget` is an accepted `MediaPlayer` prop.
- `npm run lint`
- `npm test` — updated Vidstack player component test + the rest of the Vitest suite.
- Manual (with a live stream): open `/watch/<live-channel>`, **do not** click the video,
  press `f` → player enters fullscreen; press `f` again → exits. Press `m` → mutes.
- Confirm `docs/player-keyboard-shortcuts-plan.md` exists and matches the house
  `docs/*-plan.md` style (title, `Status:`, short sections). Docs are plain Markdown —
  eslint and `next build` do not process them, so they add no separate checks.
- Optional e2e (Playwright): real-fullscreen in headless is fragile; if attempted, prefer
  asserting a non-fullscreen side effect (e.g. `m` toggles the `aria-label` of the mute
  button) after ensuring the player is active. Treat as best-effort, not required to pass.

## Out of scope
- Adding new hotkeys beyond Vidstack's defaults.
- Changing the live-appropriate shortcut set (`LIVE_KEY_SHORTCUTS`).
- Any per-player/global key conflicts (there are none to resolve).