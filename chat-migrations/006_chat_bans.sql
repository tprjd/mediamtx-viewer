-- Enforcement must survive an administrator clearing moderation history.
CREATE TABLE chat_restriction_next (
  room_id TEXT NOT NULL REFERENCES chat_room(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('Spam', 'Harassment', 'Other')),
  actor_role TEXT NOT NULL CHECK (actor_role IN ('admin', 'owner')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  PRIMARY KEY (room_id, account_id)
);
INSERT INTO chat_restriction_next
  SELECT r.room_id, r.account_id, r.record_id, m.category, m.actor_role, m.created_at, m.expires_at
  FROM chat_restriction r JOIN chat_moderation_record m ON m.id = r.record_id;
DROP TABLE chat_restriction;
ALTER TABLE chat_restriction_next RENAME TO chat_restriction;
CREATE INDEX chat_restriction_record_idx ON chat_restriction(record_id);

CREATE TABLE chat_moderation_record_next (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('message_removal', 'timeout', 'ban', 'reversal')),
  category TEXT NOT NULL CHECK (category IN ('Spam', 'Harassment', 'Other')),
  actor_account_id TEXT NOT NULL,
  target_account_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  message_id TEXT UNIQUE,
  private_note TEXT,
  created_at INTEGER NOT NULL,
  message_created_at INTEGER,
  expires_at INTEGER,
  actor_role TEXT CHECK (actor_role IN ('admin', 'owner')),
  reversed_at INTEGER,
  source_record_id TEXT
);
INSERT INTO chat_moderation_record_next
  SELECT *, NULL, NULL FROM chat_moderation_record;
DROP TABLE chat_moderation_record;
ALTER TABLE chat_moderation_record_next RENAME TO chat_moderation_record;
CREATE INDEX chat_moderation_record_page_idx ON chat_moderation_record(created_at DESC, id DESC);
