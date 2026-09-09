# 06: Compact watch details and offline state

**What to build:** Give the center watch column a clean Twitch-style player and details area. Keep common Channel information visible, move technical controls into one settings disclosure, and remove controls that have no effect while the Channel is offline.

**Blocked by:** 03: Pinned all-Channel rail on watch pages

**Status:** resolved

- [x] The desktop player uses the full center-column width with square edges and no decorative card frame
- [x] Existing player controls, playback selection, playback runs, pause behavior, progress detection, and recovery remain unchanged
- [x] Channel identity, Channel owner, live state, viewer count, description, and Share remain visible in the normal live layout
- [x] Playback modes and diagnostics move into one compact accessible settings disclosure
- [x] Opening and closing settings does not reset the selected playback mode
- [x] Live track and latency information remains available inside settings or diagnostics
- [x] An offline Channel keeps its poster, offline message, automatic status checking, identity, description, and Share action
- [x] Playback modes and diagnostics are hidden while the Channel is offline or unavailable
- [x] The offline center column receives the width that chat would use on a live page
- [x] The version footer appears below the center Channel details instead of spanning the side panels
- [x] The footer remains available on normal watch pages and keeps the version derived from the package version
- [x] Render tests cover live settings behavior, selected-mode stability, offline controls, unavailable status, and footer placement
- [x] Browser tests verify the player frame, details hierarchy, settings behavior, and 320-pixel overflow protection
- [x] An approved stable screenshot covers the offline watch state

## Comments

Implemented in commit `2979054` and pushed to `feature/twitch-style-watch-layout`.

Verified with:

- `npm test -- --run`: 203 tests passed.
- `npm run lint`.
- `npm run typecheck`.
- `npx playwright test tests/e2e/viewer.spec.ts --project=chromium`: 28 passed, 1 skipped.
- `npx playwright test tests/e2e/viewer.spec.ts --project=mobile`: 21 passed, 8 skipped.
- `npx next build --webpack`.
