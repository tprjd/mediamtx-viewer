CREATE TABLE channel_relay (
  channel_id TEXT PRIMARY KEY NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  ticket_hash TEXT UNIQUE,
  ticket_expires_at INTEGER,
  credential_hash TEXT UNIQUE,
  generation TEXT
);

CREATE TABLE relay_source_revocation (
  generation TEXT PRIMARY KEY NOT NULL,
  media_path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
