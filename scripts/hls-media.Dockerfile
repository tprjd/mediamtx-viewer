# FFmpeg 8.1.2 supplies WHIP publishing and probing on amd64 and arm64.
FROM mwader/static-ffmpeg:8.1.2@sha256:33f770f812cbfc3de96c547157fc9faf8bd95a36481753439ffa761045167585 AS media
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
COPY --from=media /ffmpeg /ffprobe /usr/local/bin/
WORKDIR /app
COPY scripts/hls-worker.mjs ./hls-worker.mjs
CMD ["node", "hls-worker.mjs"]
