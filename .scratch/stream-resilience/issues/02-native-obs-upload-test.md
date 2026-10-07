# Test OBS adaptation on macOS

Type: prototype
Status: resolved
Branch: `codex/prototype-stream-resilience`

## Question

Does native OBS lower its video encoding bitrate when publisher upload capacity
falls below the configured bitrate? Does the original WebRTC viewer recover?

## Method

OBS Studio 32.2.2 on this Mac sends one x264 H264 stream at a 2,000 kbit/s target,
720p, and 30 fps. The keyframe interval is two seconds, with no B-frames.
The OBS dynamic-bitrate setting is enabled. RTMP uses AAC; WHIP uses Opus.
The source is generated locally. No screen, microphone, or camera is captured.

A temporary Linux NAT gateway restricts packets from OBS toward MediaMTX 1.20.1.
The viewer uses a separate, unrestricted route. Each transport gets 60 seconds at
5 Mbit/s, 60 seconds at 1 Mbit/s, 120 seconds of recovery, a two-second outage,
and 60 seconds of recovery.

OBS records the same video encoder output locally. Video packet sizes establish
whether the encoder bitrate changes, independently of network delivery.
Browser samples establish frame age, freezes, and connection state.

## Limits

- The local MPEG2 source adds latency to the measurement path. The complete
  OBS baseline was about 0.43 seconds.
  Compare the complete measured delay with its baseline; do not compare it
  directly with the earlier raw FFmpeg publisher.
- Docker Desktop port forwarding and Linux packet aggregation can affect TCP
  buffering and feedback timing. The first full run queued about 3 MB of TCP
  data despite a 60-packet queue limit.
  This does not reproduce a physical WAN router exactly.
- RTMP AAC is skipped by the WebRTC viewer, so RTMP measures video only.
  The WHIP startup check requires both video and Opus audio.
- The bare viewer does not reconnect and does not use the app's Playback run
  controller or HLS fallback.
- Windows hardware encoders and iPhone 13 Safari remain untested.

## Setup findings

The first attempted RTMP profile incorrectly paired OBS RTMP output with Opus.
MediaMTX rejected that audio. The corrected profile uses supported AAC audio.
OBS's browser source produced a black picture on this Mac, including when
browser hardware acceleration was disabled. The final source uses an OBS Media
Source fed over local UDP. These setup failures are excluded from the results.

## Verification

The two-transport smoke run passed:
`.data/prototype-stream-resilience/2026-10-07T15-45-36.028Z-obs-prototype-15800/report.json`.
RTMP median frame age was 413 ms, and WHIP median frame age was 393 ms.
Neither smoke run froze. Local recordings measured about 2,000 kbit/s of video.

Run instructions remain in `scripts/prototype-stream-resilience/OBS.md` on
`codex/prototype-stream-resilience` at commit `cfa2f6f`. The prototype tool is not
yet part of the implementation branch.

## Answer

OBS RTMP reduced its video encoding bitrate. OBS WHIP did not reduce its video
encoding bitrate in this test. Both publishing connections and both original
viewer connections survived the restriction and the two-second outage.
Neither transport kept smooth, sub-second playback during the upload limit.

| Measurement | OBS RTMP | OBS WHIP |
|---|---:|---:|
| Baseline video encoding rate | 2,015 kbit/s | 2,017 kbit/s |
| Mean video encoding rate during the 1 Mbit/s limit | 1,790 kbit/s | 2,002 kbit/s |
| Video encoding rate in the final ten seconds of the limit | 1,405 kbit/s | 2,005 kbit/s |
| Baseline median frame age | 426 ms | 426 ms |
| Longest observed freeze within the upload-limit stage | 504 ms | 6,052 ms |
| Time after bandwidth restoration to the first five samples below one second | 38 seconds | 85 seconds |
| Median frame age in the final outage-recovery stage | 405 ms | 537 ms |
| OBS reconnects observed | 0 | 0 |

RTMP accumulated substantial delay. Median frame age reached 16.5 seconds
during the limit, and the recovery stage included a 7.6-second freeze.
The gateway queued about 3 MB of TCP data because Linux aggregated packets.
These delay values describe this buffer-heavy local setup, not a general WAN
prediction or a fair comparison of equal queue sizes for TCP and UDP.

WHIP delivered only 484 frames during the one-minute restriction, compared with
1,795 frames during baseline. Only nine advancing samples had a valid embedded
timestamp. Do not interpret the 861 ms median among those few valid samples as
smooth low-latency playback. MediaMTX logged missing RTP packets and damaged H264
frames. The earlier FFmpeg experiment's B-frame rejection did not occur.

The recordings share OBS's stream video encoder. Their packet sizes confirm
that RTMP's lower rate was an encoder change and WHIP's rate stayed near its
2,000 kbit/s target. OBS reported zero skipped encoding frames for both runs.

## Decision

Changing OBS's publishing protocol to WHIP alone does not provide the automatic
quality reduction required for the Discord-like goal. Native OBS WHIP did show
better connection survival than the earlier FFmpeg fixture, so that earlier
failure must not be treated as proof that OBS WHIP always disconnects.

Keep this as prototype evidence. Before selecting a production path, test a
publisher with verified upload adaptation, or a deliberately lower fixed rate.
Repeat the RTMP latency test with a byte-bounded queue or a physical network
limiter. Complete the Windows encoder, application recovery, audio, and iPhone
checks before changing the production setup.

## Evidence

- Full run: `.data/prototype-stream-resilience/2026-10-07T15-46-24.040Z-obs-prototype-16604/report.json`.
- Compact, tracked measurements: [obs-evidence.json](../obs-evidence.json).
- The full run directory contains both OBS logs, the MediaMTX log, MKV
  recordings, video packet data, and viewer screenshots.
- `npm run lint` passed. Package and lockfile metadata agree.
- This standalone experiment does not require an application build and does
  not validate application behavior.

Final checks used the saved implementation. The two-transport smoke run at
`.data/prototype-stream-resilience/2026-10-07T15-57-10.142Z-obs-prototype-21730/report.json`
passed. Median frame ages were 423 ms for RTMP and 378 ms for WHIP, with no freezes.
A separate run was interrupted with SIGINT and exited with code 130. It removed
its containers, network, generated OBS profiles, and OBS process. No prototype
containers or OBS publishing processes remained after verification. OBS remains
installed, and its temporary WebSocket control server is disabled.
