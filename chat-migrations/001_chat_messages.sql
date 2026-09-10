CREATE TABLE chat_room (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL UNIQUE,
  next_sequence INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE chat_participant (
  room_id TEXT NOT NULL REFERENCES chat_room(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  author_tag TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, account_id),
  UNIQUE (room_id, author_tag)
);

CREATE TABLE chat_message (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES chat_room(id) ON DELETE CASCADE,
  room_sequence INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  profile_name TEXT NOT NULL,
  author_tag TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (room_id, room_sequence)
);

CREATE INDEX chat_message_room_created_at_idx
ON chat_message(room_id, created_at DESC);
