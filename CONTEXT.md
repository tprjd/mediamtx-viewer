# FrankerzSpam Streaming

This context describes the private live-streaming system shared by publishers and viewers.

## Language

**Streaming contract**:
The authoritative timing and resilience promises shared by publishing, media packaging, and viewing.
_Avoid_: Latency configuration, streaming settings

**Playback mode**:
A viewer-selectable policy that balances live delay against recovery margin while honoring the streaming contract.
_Avoid_: Playback profile, preset

**Managed OBS profile**:
An OBS publishing configuration created and maintained by FrankerzSpam setup.
_Avoid_: OBS preset, generated profile
