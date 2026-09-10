# Changelog

All notable changes to this project are documented here.

## [0.9.0] - 2026-09-10

### Added

- Add the Channel directory, the live Channel rail, responsive Channel navigation, a chat placeholder, and theater mode.
- Add a one-command local streaming stack with a local administrator and sample Channels.

### Changed

- Refine the application frame, watch details, and offline state for desktop and narrow layouts.
- Move the application version from the footer to the header.

### Fixed

- Label unavailable live viewer counts and remove empty desktop watch-page scrolling.

## [0.8.0] - 2026-09-07

### Added

- Add playback availability checks and automatic fallback to Balanced HLS.

### Changed

- Make Ultra-low HLS recover from unavailable playlists and stalled playback.

## [0.7.0] - 2026-09-06

### Added

- Add Enhanced RTMP publishing with AAC audio and separate controls for the server URL and stream key.
- Encrypt Oracle deployment secrets with SOPS.

### Changed

- Replace managed OBS publishing over WHIP with Enhanced RTMP. Channel owners must download and run the current OBS setup script.

### Fixed

- Keep the Ultra-low HLS mode stable at its 1.9-second target and correct its MediaMTX configuration.
- Copy the complete Enhanced RTMP publishing path from the Channel screen.

## [0.6.2] - 2026-09-05

### Fixed

- Restore responsive dashboard, channel, and player layouts after their base styles moved into CSS modules.

### Changed

- Colocate component and page styles into CSS modules, leaving `globals.css` with only tokens, base styles, and shared primitives.
- Centralize text and status colors as design tokens.
- Remove the unused `ChannelCard` component.

## [0.6.1] - 2026-09-04

### Changed

- Footer shows only the version and uses a faded separator.

## [0.6.0] - 2026-09-04

### Added

- Discord live notifications with a per-channel opt-in toggle.
- App version in the site footer and `/api/health`.

### Fixed

- OCI byte metrics now report transferred bytes instead of accumulated counters.
- Discord notifier mounts its script from the repository root.

## [0.5.0] - 2026-09-04

### Added

- Add the streaming timing contract and the shared playback lifecycle.
- Add document-wide player keyboard shortcuts.
- Add the dashboard Channel list and the current theme palette.

### Changed

- Use a Radix dialog for stream key rotation.

## [0.4.0] - 2026-09-02

### Added

- Add resilient high-quality, Balanced HLS, and Ultra-low HLS playback modes.
- Add browser frame pacing diagnostics and expandable playback diagnostics.
- Replace native video controls with Vidstack controls.

### Fixed

- Recover stalled playback and hide the fullscreen HUD after pointer activity stops.
- Restart MediaMTX after configuration changes.

## [0.3.0] - 2026-09-01

### Added

- Add the Windows OBS setup launcher and managed OBS profiles.
- Stream Channel status updates with server-sent events.
- Add the Oracle usage statistics dashboard.
- Add editable Channel owner names.

### Fixed

- Recover stalled WebRTC video.
- Correct OBS setup mode checks and managed file replacement.

## [0.2.0] - 2026-08-30

### Added

- Add approved account access and account-owned Channels.
- Add the watch-first dashboard and stream thumbnails.
- Add reproducible Oracle deployment files.

### Fixed

- Correct proxied WebRTC session routing and AV1 thumbnail capture.
- Synchronize the watch page with the live stream status.

## [0.1.0] - 2026-08-29

### Added

- Add the initial MediaMTX viewer.
