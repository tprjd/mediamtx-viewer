ALTER TABLE user ADD COLUMN administratorApproved INTEGER NOT NULL DEFAULT 0 CHECK (administratorApproved IN (0, 1));
ALTER TABLE user ADD COLUMN legacyAccess INTEGER NOT NULL DEFAULT 0 CHECK (legacyAccess IN (0, 1));
ALTER TABLE user ADD COLUMN notificationSound INTEGER NOT NULL DEFAULT 1 CHECK (notificationSound IN (0, 1));
UPDATE user SET administratorApproved = (activationStatus = 'active'), legacyAccess = 1;
UPDATE user SET activationStatus = 'active' WHERE activationStatus = 'pending';

-- The trigger keeps registration and channel creation in the same transaction.
CREATE TRIGGER account_channel_created AFTER INSERT ON user
WHEN NEW.activationStatus != 'disabled'
BEGIN
  INSERT INTO channel (id, owner_user_id, slug, media_path, display_name, title, accent_color, preferred_playback, enabled, created_at, updated_at, created_by)
  VALUES (lower(hex(randomblob(16))), NEW.id, 'channel-' || lower(hex(randomblob(12))), 'channels/channel-' || lower(hex(NEW.id)), NEW.name, NEW.name || '''s channel', '#db2777', 'hls', 1, NEW.createdAt, NEW.updatedAt, NEW.id);
  UPDATE channel SET media_path = 'channels/' || slug WHERE owner_user_id = NEW.id;
END;
CREATE TRIGGER account_channel_restored AFTER UPDATE OF activationStatus ON user
WHEN NEW.activationStatus = 'active' AND NOT EXISTS (SELECT 1 FROM channel WHERE owner_user_id = NEW.id)
BEGIN
  INSERT INTO channel (id, owner_user_id, slug, media_path, display_name, title, accent_color, preferred_playback, enabled, created_at, updated_at, created_by)
  VALUES (lower(hex(randomblob(16))), NEW.id, 'channel-' || lower(hex(randomblob(12))), 'channels/channel-' || lower(hex(NEW.id)), NEW.name, NEW.name || '''s channel', '#db2777', 'hls', 1, NEW.createdAt, NEW.updatedAt, NEW.id);
  UPDATE channel SET media_path = 'channels/' || slug WHERE owner_user_id = NEW.id;
END;
INSERT INTO channel (id, owner_user_id, slug, media_path, display_name, title, accent_color, preferred_playback, enabled, created_at, updated_at, created_by)
SELECT lower(hex(randomblob(16))), id, 'channel-' || lower(hex(randomblob(12))), 'channels/channel-' || lower(hex(id)), name, name || '''s channel', '#db2777', 'hls', 1, createdAt, updatedAt, id
FROM user WHERE activationStatus != 'disabled' AND NOT EXISTS (SELECT 1 FROM channel WHERE owner_user_id = user.id);

UPDATE channel SET media_path = 'channels/' || slug WHERE slug LIKE 'channel-%' AND media_path = 'channels/channel-' || lower(hex(owner_user_id));

CREATE TABLE channel_viewing_request (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  viewer_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'revoked', 'closed')),
  retry_at INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(channel_id, viewer_id)
);
CREATE TABLE account_notification (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  request_id TEXT REFERENCES channel_viewing_request(id) ON DELETE SET NULL,
  request_revision INTEGER,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX notification_recipient_idx ON account_notification(recipient_id, id);
CREATE TABLE account_email_token (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE account_email_throttle (
  key TEXT PRIMARY KEY,
  sent_at INTEGER NOT NULL
);

CREATE TABLE access_revocation (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  chat_done INTEGER NOT NULL DEFAULT 0,
  media_done INTEGER NOT NULL DEFAULT 0,
  media_path TEXT,
  created_at INTEGER NOT NULL
);
