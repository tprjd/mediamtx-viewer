# 02: Twitch-style Channel directory

**What to build:** Make home a compact Channel directory with separate live and offline sections. Keep every Channel easy to scan through its poster, Channel owner initials, title, state, and viewer count while removing content that delays access to the directory.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] The large home introduction is removed
- [x] My channel and Manage users shortcut cards are removed from home
- [x] Live Channels appear in a dedicated section before other Channels
- [x] Live Channels sort by viewer count from highest to lowest and then by title
- [x] Offline Channels sort by title
- [x] An unavailable Channel remains visible in the second section with an accurate Unavailable state
- [x] Each card remains one accessible link to its watch page
- [x] Each card keeps a 16:9 poster area and uses the existing fallback when no poster is available
- [x] Each card adds circular Channel owner initials with a stable accent-color background
- [x] Each live card shows the Channel title, Channel owner, live state, and viewer count
- [x] Offline and unavailable cards use the same size as live cards with muted poster and secondary text styles
- [x] The empty directory state and delayed-status announcement remain accurate
- [x] Real-time Channel state and viewer-count updates continue without a page reload
- [x] Model tests cover section grouping, viewer-count ties, title ties, offline Channels, and unavailable Channels
- [x] Browser tests cover both sections, their order, and navigation to a watch page
- [x] An approved stable screenshot covers the desktop Channel directory

## Comments

Implemented in commits `4c1b52a` and `5a87fa3`. Lint, type checks, 190 Vitest tests, 23 Playwright tests, the stable desktop screenshot, and the isolated production build passed before this ticket was resolved. Five Playwright cases were intentionally skipped outside their applicable browser project or fixture state.
