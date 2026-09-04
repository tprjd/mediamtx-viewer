ALTER TABLE channel
  ADD COLUMN discord_notifications_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (discord_notifications_enabled IN (0, 1));
