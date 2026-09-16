# Isolate Chat storage from authentication

Store Chat messages, restrictions, moderation records, rate limits, delivery outbox entries, and per-room sequences in `chat.sqlite`. Keep authentication data in `auth.sqlite`. Chat records refer to stable account and Channel IDs without cross-database foreign keys, and each request verifies those references through the application.

Chat has a higher write rate, shorter retention period, and different backup and failure behavior than authentication. A separate database prevents Chat cleanup, growth, lock contention, or corruption from blocking account access. Stop new Chat message submissions when `chat.sqlite` reaches 2 GiB or its filesystem has less than 10 GiB free, whichever happens first. Keep both thresholds configurable. At the limit, keep history readable and leave authentication, Channel status, and playback operational.

If the Chat database is unavailable, keep messages already loaded in the browser, disable message and moderation commands, and report Chat as unavailable. A disk threshold or sustained database failure appears on the Statistics page and uses the same deduplicated Discord alert policy as a Centrifugo outage.
