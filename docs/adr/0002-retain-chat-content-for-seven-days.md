# Retain Chat content for seven days

Keep Chat messages and the original content of removed messages for seven days in a dedicated Chat database, then delete them automatically. Delete private moderation notes on the same schedule. Keep the remaining structured Chat moderation record until an administrator clears it, but do not retain expired message content in that record. Purge expired content on startup, once per hour, before backup, and immediately after restore.

Back up `auth.sqlite` and `chat.sqlite` separately in one daily job. Assign both encrypted files a shared backup identifier and manifest, retain seven daily backup sets, and permit an administrator to restore either database alone. After any Chat restore, purge expired content before the application makes Chat available.

Before enabling Chat, prove this policy with a restore drill. Restore `chat.sqlite` independently, purge expired content, reconnect Centrifugo, and confirm that authentication and playback remain available throughout.

This period gives participants recent context and gives Chat moderators short-term evidence without creating a long-term conversation archive. Indefinite moderation records preserve accountability without preserving message content or private notes.

## Administrator clearing exception

Accepted on 2026-09-17 for the administrator Chat history clearing feature.
An administrator may delete stored messages and retained original message content
from one selected Chat room before seven days have elapsed. Preserve Chat
restrictions and Chat moderation records, including their existing retention rules.

Existing backup sets expire normally. Do not rewrite them when history is cleared.
An intentional restore of an older backup may bring cleared messages back if they
have not expired. Keep the post-restore expiry purge. Explain this backup exception
when the administrator confirms clearing history.
