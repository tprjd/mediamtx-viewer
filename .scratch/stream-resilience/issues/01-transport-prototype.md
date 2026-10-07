# Compare publisher transport behavior under upload problems

Type: prototype
Status: resolved
Branch: codex/prototype-stream-resilience

## Question

Can one encoding keep low playback delay and resume after short publisher upload
problems through RTMP or WHIP, without server-side video encoding?

## Constraints

Keep the prototype in the current repository on its own branch. Reuse the pinned
MediaMTX version, the vendored WebRTC reader, and existing browser tooling. Keep
production unchanged. The production design must preserve Windows OBS publishing
and iPhone 13 viewing compatibility.

## Evidence

On the prototype branch, run `npm run prototype:stream`. The test conditions and
measurement limits remain in `scripts/prototype-stream-resilience/README.md`
on `codex/prototype-stream-resilience` at commit `cfa2f6f`. That tool is not yet
part of the implementation branch.

## Outstanding decisions

This experiment uses fixed-bitrate FFmpeg and a bare WebRTC receiver. OBS bitrate
adaptation, application recovery, iPhone playback, and HLS fallback need separate
verification before the production design can be selected.

## Answer

The experiment runs in the current checkout and reuses the existing MediaMTX
version, keyframe interval, browser installation, and WebRTC reader. No production
files or settings were changed apart from adding an npm command for the prototype.

Both transports achieved sub-second generated-frame-to-browser latency in the
normal local baseline. The fixed-bitrate publisher did not maintain the desired
behavior through the 700 kbit/s upload limit. RTMP accumulated seconds of delay.
WHIP froze and its viewer connection later closed. Neither result establishes
OBS behavior because FFmpeg did not adapt its encoding bitrate.

MediaMTX logged "WebRTC doesn't support H264 streams with B-frames" during the
impaired WHIP sequence. The publisher explicitly used H.264 baseline and zero
B-frames. The reason for that rejection is unresolved; investigate packet loss,
timestamps, and the server's detection before selecting a production transport.

The [saved evidence](../evidence.json) contains the actual summaries and queue
settings. Full local samples and logs are in
`.data/prototype-stream-resilience/2026-10-07T15-18-49.559Z-425/`.

| Transport | Stage | Median active frame age, ms | p95, ms | Active samples | Longest observed freeze, ms |
| --- | --- | ---: | ---: | ---: | ---: |
| rtmp | baseline | 55 | 104 | 31 | 0 |
| rtmp | upload-700kbit | 2400 | 4338 | 31 | 0 |
| rtmp | recover-bandwidth | 4175 | 6051 | 24 | 1766 |
| rtmp | loss-and-jitter | 1656 | 4971 | 30 | 255 |
| rtmp | recover-loss | 3271 | 4445 | 30 | 253 |
| rtmp | outage | 1842 | 1992 | 7 | 0 |
| rtmp | recover-outage | 3927 | 4543 | 23 | 1282 |
| whip | baseline | 56 | 71 | 31 | 0 |
| whip | upload-700kbit | 539 | 692 | 5 | 6601 |
| whip | recover-bandwidth | n/a | n/a | 0 | 7866 |
| whip | loss-and-jitter | n/a | n/a | 0 | 7373 |
| whip | recover-loss | n/a | n/a | 0 | 7871 |
| whip | outage | n/a | n/a | 0 | 1770 |
| whip | recover-outage | n/a | n/a | 0 | 7864 |

The stages are sequential. Backlog from an earlier stage can affect later stages.
Frame-age percentiles exclude frozen frames. Read the freeze and sample-count
columns with the latency columns. Browser connection status alone is insufficient.

## Verification

The full experiment completed for both transports under Node 22.11.0. Final
smoke verification and repository lint passed with Node 24.15.0. The smoke
report is `.data/prototype-stream-resilience/2026-10-07T15-21-13.973Z-2256/report.json`. Production build and application
regression tests are outside this standalone prototype's scope.

## Next decision

Measure actual OBS bitrate adaptation under the same publisher upload limits.
Investigate the WHIP reader rejection above. Verify the chosen path on Windows
and an iPhone 13, then define the production changes and HLS audio fallback.
The prototype is complete; the production transport decision remains open.
