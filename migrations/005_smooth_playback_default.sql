UPDATE channel
SET preferred_playback = 'hls',
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE preferred_playback = 'webrtc';
