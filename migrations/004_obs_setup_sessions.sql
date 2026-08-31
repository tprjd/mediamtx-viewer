CREATE TABLE obs_setup_session (
  id TEXT PRIMARY KEY,
  device_secret_hash TEXT NOT NULL UNIQUE,
  user_code TEXT NOT NULL COLLATE NOCASE UNIQUE,
  request_ip_hash TEXT NOT NULL,
  script_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'consumed')),
  owner_user_id TEXT REFERENCES user(id) ON DELETE CASCADE,
  channel_id TEXT REFERENCES channel(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  approved_at INTEGER,
  consumed_at INTEGER,
  last_polled_at INTEGER,
  poll_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX obs_setup_session_expires_at_idx
ON obs_setup_session(expires_at);

CREATE INDEX obs_setup_session_request_ip_idx
ON obs_setup_session(request_ip_hash, created_at DESC);

CREATE TABLE obs_setup_rate_limit (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_started_at INTEGER NOT NULL
);
