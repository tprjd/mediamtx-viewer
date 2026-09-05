# Changelog

All notable changes to this project are documented here.

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
