ALTER TABLE chat_room ADD COLUMN cleared_through INTEGER NOT NULL DEFAULT 0;

-- Content-free receipts stop an accepted send from returning after clearing.
CREATE TABLE chat_cleared_submission (
  room_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  client_idempotency_key TEXT NOT NULL,
  PRIMARY KEY (room_id, account_id, client_idempotency_key),
  FOREIGN KEY (room_id, account_id) REFERENCES chat_participant(room_id, account_id) ON DELETE CASCADE
);
