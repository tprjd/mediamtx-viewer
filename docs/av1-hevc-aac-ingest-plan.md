# AV1 + AAC and HEVC + AAC ingest plan

Status: decisions locked by grill review. No implementation yet; no files
changed. Authoritative timing and resilience policy remains
[`config/streaming-contract.v1.json`](../config/streaming-contract.v1.json);
timing values in other historical plan documents are not authoritative.

## Objective

Support both AV1 + AAC and HEVC + AAC end to end:

- OBS is the encoder.
- MediaMTX is the server.
- Playback uses hls.js / LL-HLS.
- Target latency under 3 seconds.
- Must support desktop Chrome.
- HEVC path must support iPhone 13.
- No server-side transcoding; remuxing/packaging is fine.

## Current state (verified in the repo)

- Publisher path: OBS -> WHIP over Caddy `/publish/whip/*` -> MediaMTX 1.20.1
  (`deploy/oracle/Caddyfile:29`). Managed OBS profiles set
  `AudioEncoder=ffmpeg_opus` (`scripts/windows/setup-frankerzspam-obs.ps1:653`)
  and write `type: whip_custom` in `service.json`
  (`scripts/windows/setup-frankerzspam-obs.ps1:991`).
- WHIP forces Opus in OBS and MediaMTX. This is the single blocker for both
  AV1 + AAC and HEVC + AAC.
- Playback: hls.js 1.7.1 (LL-HLS) through `@vidstack/react`, plus an opt-in
  WebRTC/WHEP low-latency mode. No server-side transcoding anywhere; MediaMTX
  only remuxes (`hlsAlwaysRemux: true`).
- Streaming contract: LL-HLS, 2 s segments / 200 ms parts, ultra-low target
  1.8 s, balanced 3 s, smooth 5 s.
- Deployment: Caddy + MediaMTX + Next.js on one Oracle A1 VM (1 OCPU ARM,
  6 GB RAM). MediaMTX publishes only 8189 UDP/TCP
  (`deploy/oracle/docker-compose.yml:38`); `deploy/oracle/terraform/main.tf`
  and `deploy/oracle/terraform/cloud-init.yaml.tftpl` open 443/80/8189/22 only.
- Stream keys are single per channel (`mtx_sk_…`, hashed at rest) and are
  validated by `authorizePublish` (`lib/channels.ts:354`) through the MediaMTX
  HTTP auth callback. The callback is protocol-agnostic: it already receives
  `path` + `token` and decides.
- The one-time OBS authorization flow (`lib/obs-setup.ts`) stays. On rotation,
  the poll route calls `disconnectChannelPublisher`
  (`app/api/obs-setup/device/poll/route.ts:79`); that function currently kicks
  only WebRTC sessions (`lib/mediamtx.ts:358`).

## Verified compatibility

| Layer | AV1 + AAC | HEVC + AAC |
| --- | --- | --- |
| OBS ingest | Enhanced RTMP (AFMA) carries AV1; OBS uses its FLV-over-HTTP implementation | Same AFMA mux; HEVC is part of the Enhanced RTMP spec |
| MediaMTX 1.20.1 | Push and HLS packaging (`av01` param string) | Playback path since 1.9; publisher (push) HEVC since 1.20 |
| hls.js 1.7.1 | Supported (MSE `av01.*`, same `CODECS` path as H.264) | Supported; `hvc1` works in Chrome, Firefox, Safari |
| Desktop Chrome | AV1 decode on modern GPUs | HEVC (incl. `hvc1`) via ClearPlay on mainstream desktop OSes |
| iPhone 13 (iOS 15+ Safari) | No HEVC support | Native HEVC hardware decode (`hvc1`); Safari HLS supports HEVC in MPEG-TS |
| Container | ISO-BMFF fMP4; MediaMTX LL-HLS muxes MPEG-4 Audio AOT 2 | Same |

Key facts:

- Apple removed HEVC from WebRTC (RTP), not from Safari HLS. HEVC-over-HLS on
  iPhone 13 works, but only at best-effort latency (see open gaps).
- Chrome desktop decodes AV1 and HEVC; HEVC needs a ClearPlay-capable OS/build
  (mainstream Windows 10+ and macOS 11+, 2023+).
- Audio is the only blocker: AAC replaces the Opus that WHIP forces.
- hls.js source already parses `hvc1`/`hev1`/`av01` and builds the codec string
  in the same path for all three. The player already classes codec errors as
  "unsupported" and offers the manual compatibility fallback. No client codec
  change is needed to add AAC.

## Locked decisions (grill review)

1. **Codec selection is per session** in OBS (the streamer picks AV1, HEVC, or
   H.264 in the managed profile). One publisher at a time; no per-path
   multiplicity; MediaMTX path config is unchanged.
2. **Opus dies everywhere.** Every managed profile uses AAC (H.264 + AAC stays
   for broad compatibility).
3. **Enhanced RTMP is the replacement ingest**, on port 1935 directly on the
   Oracle host (Caddy cannot proxy raw TCP). SRT is the fallback only if
   loss-resilient upload is needed later.
4. **The WebRTC/WHEP viewer mode is retired.** LL-HLS is the only playback
   path.
5. **RTMP token delivery:** token in the OBS URL query string
   (`?token=…`), validated by the existing MediaMTX HTTP auth callback. One
   token model, relocated from WHIP bearer to RTMP query.
6. **OBS server URL:** `rtmp://frankerzspam.duckdns.org:1935/<path>?token=…`.
   MediaMTX treats the **entire RTMP URL path as the media path** (verified in
   v1.20.1 `internal/servers/rtmp/conn.go`), so `<path>` must be the exact
   channel media path (`channels/<slug>`), not `publish/<path>`. Playback paths
   (`channels/…` regex) are therefore the publish path too.
7. **Key rotation kicks the old RTMP publisher.** `overridePublisher: true`
   is the eventual-consistency fallback.
8. **Compatibility fallback stays manual:** the existing "Try compatibility
   stream" button (`hasCompatibilityFallback`). No automatic browser sniffing.
9. **AAC is forced on every managed profile**; Opus is removed entirely.

## Ingest comparison (why Enhanced RTMP)

MediaMTX 1.20.1 supports RTSP, RTMP (incl. Enhanced RTMP/AFMA), SRT, MPEG-TS,
and WebRTC (WHIP/WHEP) ingest.

| Ingest | AV1/HEVC + AAC to MediaMTX | Server transcode | Latency to LL-HLS | Verdict |
| --- | --- | --- | --- | --- |
| **Enhanced RTMP** | Yes; the only official way to push HEVC/AV1 with AAC | Never by default | `hlsAlwaysRemux` keeps ~2 s; correct codecInfo -> CODECS | **Selected** |
| **SRT (MPEG-TS)** | AV1/HEVC + AAC; also MPEG-H AAC (AOT 24) not available via RTMP | TS repackaging adds frame latency | Same LL-HLS pipeline; needs its own loss recovery | Fallback only |
| **RTSP** | AV1/HEVC + AAC over RTP; `rtspTransports` is `[tcp]` in config | None | Works in principle; needs a codecInfo/CODECS path check | Rejected |
| **WHIP (current)** | AV1/HEVC only with Opus | - | - | Rejected: Opus-only |

## Rejected: dual-audio (Apple AAC + web Opus)

- MediaMTX cannot route a second AAC-only track to iPhone-only HLS cleanly;
  per-track low-latency is global.
- OBS sends one track mix; a second AAC track needs a second encoder and more
  upload.
- Publish one AAC track for everyone. The bitrate difference (128-160 kbps)
  is trivial.

## Concrete change set

| # | File | Change |
| --- | --- | --- |
| 1 | `scripts/windows/setup-frankerzspam-obs.ps1` | `service.json` -> `rtmp_custom` with `rtmp://frankerzspam.duckdns.org:1935/<path>?token=…` (no `whip_custom`/bearer); `Write-ManagedProfile` -> `AudioEncoder=ffmpeg_aac`, `Track1Bitrate=160`, remove `WHIPSimulcastTotalLayers`; keep keyframe/segment contract and reconnect flow. |
| 2 | `deploy/oracle/mediamtx.yml.example` + `deploy/oracle/secrets/mediamtx.yml` (SOPS-encrypted; re-encrypt via `deploy/oracle/sops-secrets.sh`) | `rtmp: true`, `rtmpEncryption: no`, `rtmpAddress: :1935`; per-path `source: publisher` + `overridePublisher: true`; keep `hlsVariant: lowLatency`, `hlsAlwaysRemux: true`, `hlsSegmentDuration: 2s`, `hlsPartDuration: 200ms`, `authMethod: http` + callback. MediaMTX 1.20.1 has no path-level codec/audio filter — codecs pass through by design (verified against the v1.20.1 shipped config). |
| 3 | `deploy/oracle/docker-compose.yml` | Publish `1935:1935/tcp` (and `1936:1936/tcp` for the RTMPS follow-up); extend `mediamtx-health` with `nc -z -w 2 mediamtx 1935`. |
| 4 | `deploy/oracle/terraform/main.tf` | Ingress rule for TCP 1935 (from `0.0.0.0/0` with token auth, or publisher CIDR). |
| 5 | `deploy/oracle/terraform/cloud-init.yaml.tftpl` | `ufw allow 1936/tcp` (RTMPS). |
| 6 | `lib/mediamtx.ts` (+ `lib/mediamtx.test.ts`) | Rewrite `disconnectChannelPublisher` to kick RTMP publishers (e.g. `/v3/rtmpconns/kick` or path-scoped publisher disconnect), covering both a WebRTC and an RTMP publisher path. |
| 7 | `app/api/obs-setup/device/poll/route.ts` | Return the RTMP URL (`rtmp://<host>:1935/<path>?token=…`) instead of the WHIP URL. |
| 8 | `components/use-playback-mode.ts`, `components/webrtc-player.tsx`, `deploy/oracle/Caddyfile` | Retire WebRTC/WHEP player mode + Caddy `/media/whep/*` + `/publish/whep/*` proxy blocks; drop `public/vendor/mediamtx-reader-1.20.1.js` + `MEDIAMTX_WEBRTC_URL`/`webrtc*` config + `webrtc: false` in mediamtx.yml. |
| 9 | `README.md`, `scripts/windows/README.md`, `docs/video-quality-resilience-plan.md` | Update ingest diagram (Enhanced RTMP, not WHIP), audio (AAC), remove WebRTC low-latency references. |
| 10 | `config/streaming-contract.v1.json` | **Revised during local validation:** adds `maxBufferLengthMs: 2000` to ultra-low so the hls.js buffer cap (2 s) sits below the forward-buffer SLO ceiling (3 s). Keeps LL-HLS/2 s/200 ms, keyframe 2 s, and all other timings. Also requires the core `maxBufferLengthMs < forwardBufferCeilingMs` invariant and the player's `averagetargetduration` packaging guard (MediaMTX 1.20.1 emits `TARGETDURATION:4` for 2 s segments). |

## MediaMTX config draft

```yaml
rtmp: true
rtmpEncryption: no
rtmpAddress: :1935
# rtmpsAddress: :1936   (requires rtmpServerKey/rtmpServerCert)

paths:
  live:
    source: publisher
    overridePublisher: true
  "~^channels/[a-z0-9]+(?:-[a-z0-9]+)*$":
    source: publisher
    overridePublisher: true
```

- Keep `hlsVariant: lowLatency`, `hlsAlwaysRemux: true`,
  `hlsSegmentDuration: 2s`, `hlsPartDuration: 200ms`.
- Do not set `hlsEncryption`; do not put codecInfo under RTSP.
- Keep `authMethod: http` (Compose override) with the existing callback so the
  public RTMP port is not an open publisher port. RTMP publish makes two auth
  calls; the first carries the token in `query`, and the second is skipped by
  the HTTP server — auth must succeed on the first call.
- MediaMTX 1.20.1 has **no** path-level `playback`/`publish` codec or password
  block. Publish authorization comes only from `authMethod: http`'s callback;
  codec/audio filtering is not a 1.20.1 feature and codecs pass through.

## Sequencing

1. `lib/mediamtx.ts` + poll route (server-side token/publisher behavior).
2. OBS script (RTMP + AAC).
3. MediaMTX config + ports.
4. WebRTC retirement.
5. Docs.
6. Validate (below).

## Validation

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `node scripts/validate-streaming-contract.mjs deploy/oracle/mediamtx.yml.example`
- Manual matrix: Chrome desktop (AV1 + AAC, HEVC + AAC), iPhone 13 Safari
  (HEVC + AAC), all within the 2 s LL-HLS segment budget and 3 s latency
  target.
- Verify MediaMTX API status shows `AV1`/`HEVC` + `MPEG-4 Audio` and correct
  `CODECS` strings.

## Open gaps and verified caveats

- **RTMP publisher kick endpoint — RESOLVED.** Verified against the MediaMTX
  v1.20.1 API: `GET /v3/rtmpconns/list` returns items with `id`, `path`,
  `state` (`idle`/`read`/`publish`), `query`; `POST /v3/rtmpconns/kick/{id}`
  kicks one connection (RTMPS has `/v3/rtmpsconns/*` equivalents). Change #6
  mirrors the existing WebRTC flow in `lib/mediamtx.ts:339-370`: list RTMP
  conns, filter `path == mediaPath && state == 'publish'`, kick each id, and
  extend the test at `lib/mediamtx.test.ts:267` with an RTMP publisher case.
- **Caddy cannot proxy raw TCP (structural, still real):** RTMP needs a
  directly listening TCP port; Caddy is HTTP-only. Implemented transport is
  plain RTMP on 1935 (token visible on-path); RTMPS on 1936 is the follow-up
  that moves the token inside TLS once certs exist. Port 443/80 and HLS are
  unaffected.
- **OBS 32 AV1 runtime gate (research-verified):** Native Enhanced RTMP over
  plain `rtmp://` is built into OBS (29.1+, PR #8522) and `rtmp_custom`
  advertises `h264;hevc;av1` + `aac`, but `rtmp-stream.c:1513` only allows
  H.264/HEVC in a runtime path; AV1 can surface as "AV1 is not supported by
  the server" (`obs-studio#13700`). Treat AV1+AAC as the **expected** path but
  verify with a short pre-flight on the real OBS 32 setup. If it fails, keep
  AV1 on WHIP+Opus temporarily while investigating. Do not fall back to SRT
  for AV1: MediaMTX does not support AV1 over SRT.
- **iPhone Safari does not do LL-HLS natively:** the native player ignores
  LL-HLS `PART` hints and reports 5-10 s+ on MediaMTX low-latency
  (`mediamtx#2317`, `#1814`). hls.js needs iOS 17.1+ (Managed Media Source;
  `hls.js#3998`). Realistic iPhone HEVC glass-to-glass is ~3-5 s with hls.js
  on iOS 17.1+; 5-10 s+ native on older iOS. The repo already treats Safari
  native HLS as capability-only, not low-latency
  (`docs/two-second-ll-hls-plan.md:170`). Under 3 s on iPhone HEVC via HLS is
  not currently attainable; the sub-3 s contract applies to desktop Chrome.
- **MediaMTX low-latency emits fMP4 `.mp4` parts**, not MPEG-TS. The plan file
  previously said "MPEG-2 TS/HLS"; corrected here.

## Locked decisions (grill review, revised after research)

1. **Codec selection is per session** in OBS (the streamer picks AV1, HEVC, or
   H.264 in the managed profile). One publisher at a time; no per-path
   multiplicity; MediaMTX path config is unchanged.
2. **Opus dies everywhere** except the temporary AV1 failure fallback. Every
   managed profile uses AAC (H.264 + AAC stays for broad compatibility).
3. **Enhanced RTMP is the replacement ingest** for both AV1+AAC and HEVC+AAC,
   on port 1935 (plain RTMP with token in URL) as the implemented transport.
   RTMPS on 1936 is a config-ready follow-up requiring TLS certs for MediaMTX
   (`rtmpServerKey`/`rtmpServerCert`). OBS and MediaMTX support AV1+AAC and
   HEVC+AAC over Enhanced RTMP; treat AV1 as expected, not experimental.
4. **The WebRTC/WHEP viewer mode is retired.** LL-HLS is the only playback
   path. WebRTC remains only as a temporary AV1+Opus fallback while the AV1
   RTMP question is investigated.
5. **RTMP token delivery:** token in the OBS URL query string (`?token=…`),
   sent in the RTMP `tcUrl` raw query, validated by the existing MediaMTX HTTP
   auth callback (`authMethod: http` in Compose; the standalone secret keeps
   `authMethod: internal` with no publish permission, matching the current
   split). Verified: MediaMTX sends RTMP `path` + raw `query` to the callback
   and extracts `token` from the query for `getToken()`. One token model,
   relocated from WHIP bearer to the RTMP URL query.
6. **OBS server URL:** `rtmp://frankerzspam.duckdns.org:1935/<path>?token=…`.
   MediaMTX treats the **entire RTMP URL path as the media path** (verified in
   v1.20.1 `internal/servers/rtmp/conn.go`), so `<path>` must be the exact
   channel media path (`channels/<slug>`), not `publish/<path>`. Playback paths
   (`channels/…` regex) are therefore the publish path too.
7. **Key rotation kicks the old RTMP publisher.** `overridePublisher: true`
   is the eventual-consistency fallback.
8. **Compatibility fallback stays manual:** the existing "Try compatibility
   stream" button (`hasCompatibilityFallback`). No automatic browser sniffing.
9. **AAC is forced on every managed profile**, with the temporary WHIP+Opus
   AV1 fallback allowed while AV1-over-RTMP is investigated.
10. **iPhone HEVC latency is handled by the existing multi-mode LL-HLS**
    (ultra-low / balanced / smooth). The sub-3 s contract applies to desktop
    Chrome; iPhone gets best-effort hls.js latency on iOS 17.1+ without a
    contract change (Q10).
