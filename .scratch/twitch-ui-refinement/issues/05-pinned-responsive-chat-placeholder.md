# 05: Pinned and responsive chat placeholder

**What to build:** Attach the honest chat placeholder to the right side of a live watch page. Let the viewer close and restore it, save that choice, and move chat below the player when the window cannot support both side panels.

**Blocked by:** 01: Full-width compact header and flat application frame; 03: Pinned all-Channel rail on watch pages

**Status:** resolved

- [x] A live Channel shows a chat placeholder about 340 pixels wide at the right viewport edge on wide layouts
- [x] The chat panel stays below the sticky header while the center column scrolls
- [x] The chat panel fills the remaining viewport height and keeps its disabled composer at the bottom
- [x] The panel states that chat is coming soon and contains no fake messages
- [x] The composer remains disabled and cannot submit a message
- [x] An offline or unavailable Channel does not show chat
- [x] A visible accessible control closes chat
- [x] A compact header control restores closed chat on a live watch page
- [x] The open or closed chat choice persists in browser storage across reloads and Channel navigation
- [x] Closing chat immediately reallocates the released width to the player without an empty grid track
- [x] At a narrow content breakpoint, chat moves below the player instead of squeezing it
- [x] Below-player chat starts collapsed behind an accessible Chat control
- [x] The narrow layout can expand and collapse chat without horizontal overflow
- [x] Render tests cover live, offline, unavailable, open, closed, and below-player states
- [x] Browser tests verify right-edge geometry, independent scrolling, saved state, player expansion, and responsive placement
- [x] An approved stable screenshot covers wide and narrow normal watch states

## Comments

Implemented with a saved browser preference, a header restore control, a pinned desktop panel, and a Radix responsive disclosure. Focused render tests, the full Vitest suite, the full Playwright suite, lint, type checks, and the webpack production build were run for delivery.
