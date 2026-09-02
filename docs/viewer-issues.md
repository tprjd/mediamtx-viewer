# Viewer issues

Status: fixed in source on 2026-09-02; deployment pending.

These issues were reported on Chrome and Edge desktop. The fixes apply to all
supported browsers and to both HLS and WebRTC playback.

## Playback remains on “Reconnecting”

### Reported behavior

After an OBS, publisher-network, or viewer-network interruption, the player
showed “Reconnecting” but did not always resume until the viewer pressed Play.
The problem affected every playback mode.

### Root causes

The original offline-to-online hypothesis was incomplete. An HLS effect is
recreated when the live status changes and requests playback again. Two other
recovery defects caused the observed behavior:

- HLS used `video.paused` to infer that the viewer deliberately paused. A
  transport interruption can also pause the video element, so this inference
  disabled all later recovery attempts.
- WebRTC requested playback immediately after receiving a replacement stream,
  before React and Vidstack had attached that stream to the video element. A
  failed early request was not repeated after attachment.

### Fix

- Vidstack now reports explicit user Play and Pause requests to each transport.
- HLS gates recovery on explicit user pause intent instead of the video
  element's transport-controlled `paused` property.
- WebRTC waits until the replacement `MediaStream` is attached before it calls
  `play()`. It retries on media readiness events if an earlier request fails
  and resumes pauses caused by the transport.
- Both transports continue to respect an explicit viewer pause.

Regression tests cover transport-induced HLS and WebRTC pauses, explicit user
pauses, and WebRTC replacement-stream attachment.

## HUD remains visible in fullscreen

### Reported behavior

The bottom controls, top-right protocol badge, and mouse cursor remained visible
after the two-second idle delay in fullscreen. Windowed controls hid correctly.

### Root cause

The CSS rule `.media-player:focus-within .media-controls` overrode Vidstack's
hidden state. The fullscreen button retained focus inside the fullscreen player,
so the control bar could not become transparent. The custom player also had no
cursor-hiding rule. The protocol badge was always visible by design.

### Fix

- `:focus-within` keeps controls visible only in windowed mode.
- In fullscreen, Vidstack's `data-visible` state is authoritative.
- The protocol badge follows the same visibility state in windowed and
  fullscreen playback.
- The cursor is hidden while fullscreen controls are idle and reappears with
  the controls.

A Chromium desktop/mobile browser test verifies hidden and visible fullscreen
states while a control retains focus.
