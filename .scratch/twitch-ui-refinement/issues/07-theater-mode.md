# 07: Theater mode

**What to build:** Add a theater mode that gives the viewport to video and chat. The player controls enter and leave the mode. Overlay controls remain available when the hidden header cannot restore chat.

**Blocked by:** 05: Pinned and responsive chat placeholder; 06: Compact watch details and offline state

**Status:** resolved

- [x] A clearly named player control enters theater mode
- [x] Theater mode hides the global header, channel rail, Channel details, and footer
- [x] Video and open chat use the full viewport without document overflow
- [x] Chat remains on the right in theater mode while open
- [x] Closing chat gives its width to the player
- [x] When chat is closed, a player-overlay control restores it without requiring the hidden header
- [x] The player controls provide a clear way to leave theater mode
- [x] Leaving theater mode restores the normal header, rail, details, chat choice, and footer
- [x] Theater mode does not persist after a reload or Channel navigation
- [x] Escape behavior does not conflict with fullscreen, menus, or the mobile channel drawer
- [x] Existing fullscreen behavior and idle player-control behavior remain unchanged
- [x] Keyboard focus stays visible and moves to a usable control when a theater transition hides the focused element
- [x] Browser tests cover entry, exit, chat close and restore, width reallocation, reload reset, and Channel-navigation reset
- [x] An approved stable screenshot covers theater mode with chat open and closed
- [x] The current UI inventory describes the finished home, normal watch, mobile, offline, and theater states accurately

## Comments

Implemented with temporary in-memory theater state, viewport-fixed layout styles,
player controls for entry and exit, an in-player chat restore control, and focus
return for chat transitions. Theater state is keyed to the watched Channel and
is not stored in browser preferences.

Verification: the full Vitest suite passes (32 files, 206 tests), lint and
typecheck pass, the Webpack production build passes, and the full Playwright
viewer suite passes (54 tests, 10 skipped by the existing project matrix). The
default Turbopack build is blocked in this environment by a process-permission
error while processing an existing CSS module.
