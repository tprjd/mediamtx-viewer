# Chat failure test media

This fixture contains 120 seconds of silent blue H.264 video at 160 × 90 pixels and ten frames per second. The browser tests serve it through Playwright routes. They check video progress, pause events, source stability, and playback mode while Chat fails.

Regenerate the fixture from the repository root with the existing MediaMTX FFmpeg image:

```sh
docker run --rm --entrypoint ffmpeg \
  -v "$PWD/tests/e2e/fixtures/chat-playback:/output" \
  bluenviron/mediamtx:1.20.1-ffmpeg \
  -hide_banner -loglevel error -y \
  -f lavfi -i color=c=blue:s=160x90:r=10 -t 120 \
  -c:v libx264 -preset ultrafast -g 20 -sc_threshold 0 -pix_fmt yuv420p \
  -f hls -hls_time 2 -hls_playlist_type vod \
  -hls_segment_type fmp4 -hls_flags single_file \
  -hls_segment_filename /output/media.mp4 /output/index.m3u8
```
