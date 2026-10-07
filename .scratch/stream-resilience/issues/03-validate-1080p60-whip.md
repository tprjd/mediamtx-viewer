# 03: Verify 1080p60 through the real viewer

**What to build:** Establish the initial Windows OBS to application viewer path
at 1080p60 with sound on iPhone 13. Use that working configuration as the starting
point for the separate Managed OBS profile and subsequent recovery work.

**Blocked by:** None.

**Status:** resolved

Type: prototype
Spec: [Managed OBS WHIP streaming](../spec.md)

- [x] The Channel owner reports that the first proposed ticket has already been
  tested and is acceptable.
- [x] Accept that user report as completion of this initial validation ticket.

## Completion record

Completed by user report on 2026-10-07. The user's confirmation refers to the
first ticket in the approved breakdown, which is ticket 03 after the two
earlier prototype tickets.

No new agent-run test occurred when this ticket was resolved. The user did not
provide numeric delay measurements, exact encoder settings, device versions,
or outage logs in that confirmation. Do not invent those results or substitute
the earlier Mac 720p experiment for them.

Ticket 05 captures the user's working OBS settings before generating the
Managed OBS profile. Ticket 06 verifies and implements the agreed short-outage
behavior. Ticket 07 retains the complete physical-device acceptance run after
the generated profile, fallback, and recovery changes are integrated.

## Comments

The user requires 1080p60 minimum. Automatic quality reduction is outside the
first release; fixed bitrate selection remains an engineering measurement.

2026-10-07: The user approved the proposed breakdown and reported:
"ok the first one 1 tested so its good, othervise i agree".
Resolved on that report; the final integrated pilot remains a separate ticket.
