# FrankerzSpam Streaming

This context defines the canonical language for the private live-streaming system.

## Language

### Shared streaming

**Streaming contract**:
The authoritative timing and resilience promises shared by publishing, media packaging, and viewing.
_Avoid_: Latency configuration, streaming settings

### Access

**Viewing access**:
Permission to watch channels, granted through an account's active status.
_Avoid_: Viewing grant, viewer permission

**Streaming access**:
An administrator-granted permission for an active account to own one channel and publish while that channel is enabled.
_Avoid_: Publishing grant, broadcaster access

### Publishing

**Channel**:
A named live-stream destination owned by one account for publishing and viewing.
_Avoid_: Stream, broadcast

**Channel owner**:
The account that manages one channel's metadata and stream key and approves OBS setup for that channel.
_Avoid_: Streamer, publisher

**Publisher**:
A client that sends live media to a channel with its stream key.
_Avoid_: Channel owner, streamer

**Stream key**:
A revocable secret credential that grants publishing access to one channel.
_Avoid_: OBS password, channel password

**OBS setup session**:
A short-lived, single-use authorization exchange that links the OBS setup script to a channel owner's approval.
_Avoid_: Device login, setup code

**Managed OBS profile**:
An OBS publishing configuration created and maintained by FrankerzSpam setup.
_Avoid_: OBS preset, generated profile

### Playback

**Playback mode**:
A viewer-selectable policy that balances live delay against recovery margin while honoring the streaming contract.
_Avoid_: Playback profile, preset

**Playback run**:
One active attempt to render a channel through the selected playback mode, from joining through recovery or exit.
_Avoid_: Player lifecycle, playback session

**Viewer identity**:
An opaque identity for one watch visit, shared across playback transports so one viewer counts once.
_Avoid_: MediaMTX reader ID, browser session
