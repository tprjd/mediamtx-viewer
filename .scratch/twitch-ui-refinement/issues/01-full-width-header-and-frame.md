# 01: Full-width compact header and flat application frame

**What to build:** Give every page a compact Twitch-style application frame. The header spans the full window, stays visible during scrolling, and exposes the agreed role-based actions without crowding the page. Flat dark surfaces replace the ambient glows while task content outside the viewer experience stays centered.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] The header spans the viewport with about 16 pixels of horizontal edge padding and no centered maximum width
- [x] The header stays pinned to the top during document scrolling
- [x] The header is about 50 pixels tall on desktop and mobile
- [x] The FrankerzSpam brand remains visible on the left and links to home
- [x] A Channel owner sees My channel as a compact visible action
- [x] A signed-in account sees an accessible account-initial control
- [x] The account menu contains Statistics, Admin when authorized, and Sign out
- [x] The account menu returns focus to its trigger after it closes
- [x] The header does not add a search field
- [x] Administration, account, statistics, authentication, and OBS setup content remains centered and functionally unchanged
- [x] Ambient background glows are removed across the application
- [x] Shared surfaces use the existing dark theme and FrankerzSpam pink accent with flatter separators and less decorative rounding
- [x] Browser tests verify header geometry, sticky behavior, and role-based actions through visible behavior
- [x] An approved stable screenshot covers the shared desktop application frame

## Comments

Implemented in commit `22efc99`. Lint, type checks, 187 Vitest tests, focused desktop and mobile browser tests, and the webpack production build passed before this ticket was resolved.
