# FrankerzSpam Streaming

This context defines the canonical language for the private live-streaming system.

## Language

### Shared streaming

**Streaming contract**:
The authoritative timing and resilience promises shared by publishing, media packaging, and viewing.
_Avoid_: Latency configuration, streaming settings

### Access

**Account credentials**:
A username and password used to sign in to one account. They do not grant streaming access and are not a stream key.
_Avoid_: Login credentials, website credentials

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

### Chat

**Chat room**:
The conversation associated with one Channel and available while that Channel is live. It remains the same when publishing stops or restarts.
_Avoid_: Stream chat, broadcast chat

**Chat participant**:
An active account that can read and send messages in Chat rooms.
_Avoid_: Chatter, chat user

**Chat author tag**:
A stable, short identifier that distinguishes a Chat participant within one Chat room without exposing account credentials or an internal account identifier.
_Avoid_: Username, account ID, discriminator

**Chat message**:
A plain-text contribution that a Chat participant sends to one Chat room. It keeps the participant's display name as it was when sent.
_Avoid_: Comment, post

**Chat moderator**:
A Chat participant who can moderate a Chat room. Administrators moderate every room and its Channel owner, while a Channel owner moderates their own room but cannot restrict an administrator or moderate while under an administrator's Chat restriction.
_Avoid_: Chat admin, mod

**Chat restriction**:
A Chat timeout or Chat ban that prevents one Chat participant from sending messages without removing Viewing access.
_Avoid_: Mute, sanction

**Chat timeout**:
A Chat restriction that expires after a set period.
_Avoid_: Mute, suspension

**Chat ban**:
An indefinite Chat restriction that remains until an authorized Chat moderator lifts it.
_Avoid_: Account ban, block

**Message removal**:
A moderation action that replaces one Chat message with a content-free tombstone. The original content is available only to Chat moderators while the system retains it.
_Avoid_: Message deletion, retraction

**Chat moderation record**:
A durable record of a Chat moderator's action and its target.
_Avoid_: Chat audit log, mod log
