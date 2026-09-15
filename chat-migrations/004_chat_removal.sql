ALTER TABLE chat_message ADD COLUMN removed_sequence INTEGER;
ALTER TABLE chat_message ADD COLUMN removed_at INTEGER;

CREATE TABLE chat_moderation_record (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action = 'message_removal'),
  category TEXT NOT NULL CHECK (category IN ('Spam', 'Harassment', 'Other')),
  actor_account_id TEXT NOT NULL,
  target_account_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  message_id TEXT NOT NULL UNIQUE,
  private_note TEXT,
  created_at INTEGER NOT NULL,
  message_created_at INTEGER NOT NULL
);

CREATE INDEX chat_message_revision_idx
ON chat_message(room_id, COALESCE(removed_sequence, room_sequence));
