FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
# Match the production worker's native FFmpeg protocols. librtmp builds do not
# expose the enhanced RTMP codec negotiation needed to read Opus.
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY scripts/hls-worker.mjs ./hls-worker.mjs
CMD ["node", "hls-worker.mjs"]
