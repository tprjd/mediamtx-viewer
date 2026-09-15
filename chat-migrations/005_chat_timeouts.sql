-- Private control events do not refer to a Chat message.
CREATE TABLE chat_outbox_next (
  id TEXT PRIMARY KEY,
  message_id TEXT UNIQUE REFERENCES chat_message(id) ON DELETE CASCADE,
  channel_name TEXT NOT NULL,
  payload TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT INTO chat_outbox_next SELECT * FROM chat_outbox;
DROP TABLE chat_outbox;
ALTER TABLE chat_outbox_next RENAME TO chat_outbox;
CREATE INDEX chat_outbox_ready_idx ON chat_outbox(next_attempt_at, created_at);

CREATE TABLE chat_moderation_record_next (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('message_removal', 'timeout')),
  category TEXT NOT NULL CHECK (category IN ('Spam', 'Harassment', 'Other')),
  actor_account_id TEXT NOT NULL,
  target_account_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  message_id TEXT UNIQUE,
  private_note TEXT,
  created_at INTEGER NOT NULL,
  message_created_at INTEGER,
  expires_at INTEGER,
  actor_role TEXT CHECK (actor_role IN ('admin', 'owner'))
);
INSERT INTO chat_moderation_record_next
  SELECT *, NULL, NULL FROM chat_moderation_record;
DROP TABLE chat_moderation_record;
ALTER TABLE chat_moderation_record_next RENAME TO chat_moderation_record;

CREATE TABLE chat_restriction (
  room_id TEXT NOT NULL REFERENCES chat_room(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  record_id TEXT NOT NULL REFERENCES chat_moderation_record(id),
  PRIMARY KEY (room_id, account_id)
);
