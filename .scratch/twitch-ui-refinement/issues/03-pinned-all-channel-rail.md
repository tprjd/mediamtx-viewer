# 03: Pinned all-Channel rail on watch pages

**What to build:** Turn the live-only watch rail into all-Channel navigation attached to the left side of the window. The rail stays below the header during scrolling, scrolls its own list, and gives width back to the player when the viewer collapses it.

**Blocked by:** 01: Full-width compact header and flat application frame

**Status:** resolved

- [x] The watch workspace is no longer constrained by the centered page maximum width or outer horizontal gutter
- [x] The expanded channel rail is about 240 pixels wide and touches the left viewport edge
- [x] The channel rail stays below the sticky header while the center column scrolls
- [x] The channel rail fills the remaining viewport height and scrolls a long list independently
- [x] The rail groups live Channels first and offline or unavailable Channels second
- [x] Live Channels sort by viewer count from highest to lowest and then by title
- [x] Other Channels sort by title and retain accurate state labels
- [x] The watched Channel has an accessible current-page state
- [x] The collapsed rail is about 64 pixels wide and shows owner initials with live or muted state styling
- [x] Each collapsed item has an accessible tooltip with the Channel title, Channel owner, state, and viewer count when live
- [x] The expand and collapse control appears at the top of the rail instead of in the global header
- [x] The first wide visit starts with the rail expanded
- [x] The expanded or collapsed choice persists in browser storage
- [x] Narrower desktop widths collapse the rail before reducing the player below a useful width
- [x] Collapsing the rail immediately reallocates the released width to the player
- [x] Channel state updates continue through the existing real-time flow
- [x] Model and render tests cover grouping, ordering, current state, tooltips, preferences, and unavailable status
- [x] Browser tests verify left-edge geometry, independent scrolling, persistence, and player expansion
- [x] An approved stable screenshot covers the expanded and collapsed desktop watch states

## Comments

Implemented in commit `8408d33`. Lint, type checks, 189 Vitest tests, and 30 Playwright tests passed. Six Playwright cases were intentionally skipped outside their applicable browser project or fixture state. The standards and ticket reviews found no remaining issues.

The production build did not complete in this execution environment. Turbopack could not bind its CSS worker port, and the webpack fallback could not parse the TypeScript 6 `--showConfig` output.
