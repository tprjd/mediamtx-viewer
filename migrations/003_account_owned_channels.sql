CREATE TABLE channel (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE CASCADE,
  slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
  media_path TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  accent_color TEXT NOT NULL DEFAULT '#8b5cf6',
  preferred_playback TEXT NOT NULL DEFAULT 'hls'
    CHECK (preferred_playback IN ('hls', 'webrtc')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT REFERENCES user(id) ON DELETE SET NULL
);

CREATE INDEX channel_enabled_idx ON channel(enabled);

CREATE TABLE channel_stream_key (
  channel_id TEXT PRIMARY KEY REFERENCES channel(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  token_hint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  rotated_at INTEGER
);

INSERT INTO channel (
  id, owner_user_id, slug, media_path, display_name, title, description,
  accent_color, preferred_playback, enabled, created_at, updated_at, created_by
)
SELECT
  lower(hex(randomblob(16))), id, 'live', 'live', 'Main channel', 'Live stream',
  'Games and occasional broadcasts, streamed directly from home.',
  '#8b5cf6', 'hls', 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000, id
FROM user
WHERE role = 'admin' AND activationStatus = 'active'
ORDER BY createdAt ASC
LIMIT 1;
