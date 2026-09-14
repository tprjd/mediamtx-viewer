ALTER TABLE chat_participant ADD COLUMN next_send_time INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_message ADD COLUMN client_idempotency_key TEXT;

CREATE UNIQUE INDEX chat_message_submission_idx
ON chat_message(room_id, account_id, client_idempotency_key);

CREATE INDEX chat_message_participant_time_idx
ON chat_message(room_id, account_id, created_at DESC);
