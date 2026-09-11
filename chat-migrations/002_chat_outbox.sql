CREATE TABLE chat_outbox (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE REFERENCES chat_message(id) ON DELETE CASCADE,
  channel_name TEXT NOT NULL,
  payload TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX chat_outbox_ready_idx
ON chat_outbox(next_attempt_at, created_at);
