# Chat health and storage limits

`GET /api/health` reports core health and a separate `chat` object. A Chat fault does not change the HTTP status when core viewing is healthy.

| Chat status   | Meaning                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `disabled`    | `CHAT_ENABLED` is not `true`.                                                                   |
| `healthy`     | Chat storage and the Centrifugo API are available, with no pending deliveries or storage limit. |
| `degraded`    | Centrifugo is unavailable, deliveries are pending, or a storage limit prevents new submissions. |
| `unavailable` | The Chat database or required Chat configuration is unavailable.                                |

The administrator's Statistics page shows each active fault, its start time, pending deliveries, the oldest pending delivery, and storage measurements. A fault becomes sustained after five minutes. The viewer checks Chat health every ten seconds. Fault start times in Statistics reset when the viewer process restarts.

Centrifugo has an independent container health check. Caddy does not wait for Chat health before it starts. The viewer's container startup permits a failed Chat migration and reports Chat health separately. `npm run chat:migrate` still fails if the migration fails. After you repair storage, run this command again before you restore Chat service.

## Storage limits

Set these environment variables on the viewer service. Both values must be positive integers in bytes.

| Variable                    | Default                  | New submissions stop when                      |
| --------------------------- | ------------------------ | ---------------------------------------------- |
| `CHAT_DATABASE_LIMIT_BYTES` | `2147483648`, or 2 GiB   | Chat storage reaches or exceeds the limit.     |
| `CHAT_MINIMUM_FREE_BYTES`   | `10737418240`, or 10 GiB | Available filesystem space is below the limit. |

Chat storage includes the database and its write-ahead log. The check also counts committed pages that have not reached the main database file. The submission transaction checks both limits before it stores a new message. A retry can still retrieve an accepted message. Invalid limits or failed storage measurements stop new submissions.

At a limit, Chat keeps retained history readable and pauses sending. Moderation remains available if the database can accept commands. When the database fails, Chat keeps loaded messages visible and disables sending and moderation. A Centrifugo outage permits durable submissions and shows delayed delivery. These states do not change playback settings or Channel status.

## Discord alerts

The existing Discord notifier polls Chat health independently of the Channel event stream. Each fault must remain active for five minutes before the notifier sends an alert. Repeated checks do not repeat that alert. When an alerted fault clears, the notifier sends one recovery alert. Short faults do not produce an alert or a recovery message. If a failed database check prevents a storage or outbox check, the previous fault stays unresolved until a successful check confirms recovery.

The notifier stores Chat alert state at `${STATE_FILE}.chat` on its existing persistent volume. A notifier restart preserves alert state. Failed Discord requests are retried on the next check. Pending outbox entries count as a fault until the queue drains. A brief queue after a submission therefore does not cause an alert.

## Operational logs

Chat health logs contain fixed event types, fault codes, and results. Chat migration and alert failures use fixed error codes. The Centrifugo container uses the `warn` log level. Do not enable request-body or debug logging for Chat.

Operational logs must not contain message content, profile names, private notes, tokens, cookies, or client idempotency keys. The log-capture tests exercise successful publication, rejected requests, and failures against the pinned Centrifugo image.
