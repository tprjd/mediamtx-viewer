FROM node:24-alpine

ARG SOURCE_FINGERPRINT=unverified
ARG SOURCE_REVISION=unverified
ARG SOURCE_REPOSITORY=https://github.com/tprjd/mediamtx-viewer
LABEL org.frankerzspam.source=$SOURCE_FINGERPRINT
LABEL org.opencontainers.image.revision=$SOURCE_REVISION
LABEL org.opencontainers.image.source=$SOURCE_REPOSITORY

RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY scripts/thumbnail-worker.mjs ./thumbnail-worker.mjs

ENV NODE_ENV=production
ENV THUMBNAIL_DIR=/thumbnails

CMD ["node", "thumbnail-worker.mjs"]
