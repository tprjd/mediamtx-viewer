# WHIP packet-loss test fixture

`node scripts/test-whip-packet-loss.mjs` tests a candidate MediaMTX repair in
temporary checkouts. It needs Git, Go, a C compiler for the race detector, and
network access for public dependencies. It does not change the deployed image.

The runner pins MediaMTX 1.20.1 and gortsplib 5.6.4 to exact commits. The patches
increase the video reorder window and SRTP replay window from 64 to 512 packets.
Packet authentication and duplicate rejection stay enabled. A 200 ms reorder
deadline applies to video and audio. Normal, ordered packets have no added wait.

Each buffered packet keeps its own arrival time. Expiry releases packets through
the last expired packet, then any packets that follow without a gap. Newer gaps
keep their repair time. New arrivals and partial repairs do not extend old waits.

The deadline is checked when a new packet arrives. During complete input silence,
the receiver cannot release buffered packets until input resumes. The window also
has a packet-count limit, so sufficiently late repairs still fail.

The encrypted packet tests cover these conditions:

- A burst of 128 packets returns 150 ms late, with no permanent loss.
- A burst of 32 packets never returns.
- Every 100th, 20th, or 5th packet is lost during the impaired interval.
- A burst returns 400 ms late, beyond the repair window.
- A permanent gap affects slow video and 50-packet-per-second audio.
- Sequence numbers wrap, and output stays ordered without duplicates.
- Permanent loss overlaps with repeated repairs delayed by 150 ms.

The steady-input cases assert a maximum wait of 200 ms plus one packet interval.
A separate UDP WebRTC test verifies that packet 1 can arrive after packets 2–301
and that an authenticated duplicate is rejected. The runner also checks existing
receiver and WebRTC behavior with the Go race detector, then builds MediaMTX.

Six receiver regression cases check overlapping gaps, partial repairs, duplicate
arrivals, and separate deadlines. Each case runs across normal sequence numbers
and sequence-number wrap, with exact output and lost-packet counts at each step.

These tests check transport behavior with synthetic RTP. They do not prove that
H.264 remains watchable at 20% loss, measure display latency, or validate a live
rollout. The production Compose file still uses the official MediaMTX image.
