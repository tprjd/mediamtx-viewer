# Implement and validate the bounded HLS cache

Status: implemented and verified locally

Depends on [the baseline measurements](01-measure-hls-access.md).

Implement the shared authorization path and tests in the [cache plan](../spec.md). Exercise the Caddy route with its internal credential and the direct route with real signed session cookies. Cover cold and warm entries, parallel requests, expiry, revocation, scope isolation, and error responses. Verify existing WHEP behavior.

Repeat the baseline, report the measured CPU and check rates, and update the account access guide with the HLS grace period. Review the measurements before a production rollout.
