# Measure the HLS access path

Status: verified locally on 2026-11-20

| Build | Signed-in viewers | Authorized HLS requests/s | Full session checks/s | Channel checks/s | Viewer-app CPU ms/request | Playback stalls |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Before | 5 | 99.96 | 99.96 | 99.96 | 1.268 | 0 |
| With cache | 5 | 100.17 | 1.17 | 1.17 | 0.752 | 0 |
| Before | 10 | 199.95 | 199.95 | 199.95 | 1.203 | 0 |
| With cache | 10 | 200.19 | 2.30 | 2.30 | 0.671 | 0 |

The baseline used commit `e4e3d47`. The second build added the HLS authorization
change to that commit. Both ran on the same local ARM64 Mac with Node 24.15.0.
Each row covers one 30-second sample. All players advanced at least 30 seconds
during each sample. No media request failed. No player reported a fatal error.

## Repeat the measurement

1. Build each version in a separate directory with `npm run build -- --webpack`.
   Use a temporary SQLite database with the repository migrations. Create one
   Channel owner and ten active test accounts with Channel approval. Give each
   account a separate signed Better Auth session.
2. For each test build, count calls at entry to `getActiveSession` and
   `canWatchChannel`. Read both counters and `process.cpuUsage()` from the
   running viewer process before and after each sample.
3. Run MediaMTX 1.20.1 and Caddy 2.11.4 on a private Docker network. Use the
   production Caddyfile with a localhost TLS origin and the viewer upstream
   pointed at the test server. Use the same stream for both builds. Publish
   H.264 video at 320 × 180, 30 fps with a two-second keyframe interval and AAC
   audio. Configure MediaMTX for two-second LL-HLS segments and 200 ms parts.
4. Open five independent Chrome contexts with Playwright. Give each context
   its own test session cookie. Play the HLS URL through Caddy with the
   repository's hls.js version and Balanced settings. Give each player a
   different Viewer identity. Use a video-only test page to exclude chat,
   channel directory polling, and notification requests from the measurement.
5. Wait until each video fires `playing`, then wait 3.5 seconds. For 30 seconds,
   count successful and failed HLS responses, video `waiting` events, and fatal
   hls.js errors. Read each video's current time at both ends of the sample.
   Divide the change in process user plus system CPU time by the number of
   successful HLS responses. Close all contexts, then repeat with ten.
6. Warm an approved viewer's playlist through Caddy and through the direct
   viewer route. Revoke the stored Channel approval. Request the playlist
   immediately, then at 100 ms intervals until Caddy responds with HTTP 403.
   Confirm the direct viewer route also returns 403.

The first baseline request after revocation returned HTTP 403. The check
completed in 10 ms. With the cache, the first request returned HTTP 200 and the
first denial arrived 2.216 seconds after the change. The remaining grant lifetime
depends on when the previous check started.

These samples measure viewer-app CPU on the authorization path. They do not
measure full-page CPU, production VM capacity, or network savings.
