CREATE TABLE site_setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT REFERENCES user(id) ON DELETE SET NULL
);

INSERT INTO site_setting (key, value, updated_at, updated_by)
VALUES ('registration_open', 'false', 0, NULL);

CREATE TABLE auth_audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  target_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX auth_audit_log_created_at_idx
ON auth_audit_log(created_at DESC);

CREATE TABLE auth_reset_token (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX auth_reset_token_user_id_idx ON auth_reset_token(user_id);
CREATE INDEX auth_reset_token_expires_at_idx ON auth_reset_token(expires_at);

