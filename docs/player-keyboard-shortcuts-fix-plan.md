# Player keyboard shortcuts: keybind fix plan

Status: Proposed. Diagnosis is complete; no code has changed.

## Symptom

The document-wide hotkeys from `player-keyboard-shortcuts-plan.md` were
implemented, but pressing `f`, `m`, `k`, `Space`, or the volume arrows on a
watch page does nothing. The failure happens with and without first focusing
the video.

## Root cause

`components/vidstack-player.tsx` passes `keyShortcuts` as
`LIVE_KEY_SHORTCUTS`, an object that contains only four disabled entries:

```ts
const LIVE_KEY_SHORTCUTS = {
  seekBackward: null,
  seekForward: null,
  slowDown: null,
  speedUp: null,
}
```

Vidstack 1.15.6 treats the `keyShortcuts` prop as a full replacement, not a
merge with its default map. The default is `MEDIA_KEY_SHORTCUTS`, which binds
`toggleFullscreen` to `f`, `toggleMuted` to `m`, `togglePaused` to `k Space`,
and volume to the arrow keys. When React passes a shortcut object, Vidstack
stores that exact object, and its keyboard controller matches keys only
against it. With only four `null` entries in the map, no key can match.

`keyTarget="document"` is correctly wired and is still needed, but it cannot
help because the shortcut map contains no active bindings.

The earlier plan assumed Vidstack keeps its default bindings unless a given key
is overridden. That assumption is wrong for this version. The unit test added
with the implementation only checks that `keyTarget` reaches `MediaPlayer`, so
it passes without exercising the shortcut map.

## Decision

Restore the defaults by starting from `MEDIA_KEY_SHORTCUTS` and overriding only
the live-inappropriate entries. Keep `keyTarget="document"`.
`MEDIA_KEY_SHORTCUTS` is exported by `@vidstack/react`, so the spread can use
the library's own default map rather than a local copy.

## Change

In `components/vidstack-player.tsx`, import `MEDIA_KEY_SHORTCUTS` from
`@vidstack/react` and redefine `LIVE_KEY_SHORTCUTS`:

```ts
const LIVE_KEY_SHORTCUTS = {
  ...MEDIA_KEY_SHORTCUTS,
  seekBackward: null,
  seekForward: null,
  slowDown: null,
  speedUp: null,
}
```

The resulting bindings enable `f`, `m`, `k`/`Space`, `i`, `c`, and the volume
arrows. They disable `j`/`l`/arrow seeking and `>`/`<` playback-speed changes,
which do not make sense for live playback.

## Test

Update `components/vidstack-player.test.tsx` so the mocked `MediaPlayer` also
captures `keyShortcuts`, then assert that the map includes the active defaults
(`toggleFullscreen: 'f'`, `toggleMuted: 'm'`, `togglePaused: 'k Space'`,
`volumeUp: 'ArrowUp'`, `volumeDown: 'ArrowDown'`) and the four `null`
overrides. Keep the existing `keyTarget: 'document'` assertion. This test
fails against the current code, which is the regression guard the fix needs.

## Validation

- `npm run typecheck`
- `npm run lint`
- `npm test`
- Manual check on a live channel without clicking the video: `f` toggles
  fullscreen, `m` toggles mute, `k`/`Space` toggles pause, the volume arrows
  change volume, and `j`/`l`/`>`/`<` do nothing.

## Documentation follow-up

Update `docs/player-keyboard-shortcuts-plan.md` where it says leaving
`LIVE_KEY_SHORTCUTS` unchanged keeps `f` at the default. The fix mechanism is:
start from `MEDIA_KEY_SHORTCUTS`, then disable the live-inappropriate entries.
Without that correction, a future change can reintroduce this bug.

## Out of scope

Adding new hotkeys beyond the Vidstack defaults, changing the
`keyTarget` behavior, and per-player or global key-conflict work.
