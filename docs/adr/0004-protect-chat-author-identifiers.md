# Protect Chat author identifiers

Store the internal account ID with each Chat message and snapshot the participant's profile name when the message is sent. Show the snapshot with a stable four-character Chat author tag derived from a keyed hash of the account and Chat room IDs. If a tag collides in one room, extend only the newer participant's tag until it is unique. Keep the dedicated HMAC secret stable and rotate it only as an intentional tag reset.

Never expose account usernames, email addresses, or raw account IDs through Chat. Profile names are public but not unique, usernames can be absent and are otherwise visible only to administrators, and raw account IDs are internal. Current Admin and Owner badges may appear beside an author, but Chat does not store them as historical message attributes.
