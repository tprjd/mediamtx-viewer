# 04: Channel rail on home and mobile

**What to build:** Make the channel rail available from home and from narrow viewer layouts. Home uses the pinned desktop rail. Narrow home and watch pages use an accessible left-side drawer that closes after the viewer selects a Channel.

**Blocked by:** 02: Twitch-style Channel directory; 03: Pinned all-Channel rail on watch pages

**Status:** resolved

- [x] The desktop home page shows the same pinned channel rail as a watch page
- [x] The home rail touches the left viewport edge, stays below the sticky header, and scrolls independently
- [x] The home content uses the width beside the expanded or collapsed rail without horizontal overflow
- [x] The saved rail choice applies consistently on home and watch pages
- [x] Administration, account, statistics, authentication, and OBS setup pages do not show the channel rail
- [x] Phone and narrow tablet layouts replace the pinned rail with a left-side Radix drawer
- [x] A compact accessible header control opens the drawer on both home and watch pages
- [x] The drawer contains the same Channel groups, ordering, states, and current-page indication as the desktop rail
- [x] Selecting a Channel closes the drawer and opens the selected watch page
- [x] Closing the drawer without a selection returns focus to its trigger
- [x] The drawer traps focus while open and closes with Escape
- [x] Browser tests cover the desktop home rail and shared saved preference
- [x] Mobile browser tests cover opening, keyboard dismissal, focus return, Channel selection, and no horizontal overflow
- [x] An approved stable screenshot covers the mobile Channel drawer

## Comments

Implemented in commit `ae2cd2c`. Lint, type checks, 191 Vitest tests, 37
Playwright tests, and the webpack production build passed. Seven Playwright
cases were skipped outside their applicable browser project or fixture state.
The Turbopack build could not bind its CSS worker port in this execution
environment. The standards and ticket reviews found no remaining issues.
