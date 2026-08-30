FROM node:24-alpine

RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY scripts/thumbnail-worker.mjs ./thumbnail-worker.mjs

ENV NODE_ENV=production
ENV THUMBNAIL_DIR=/thumbnails

CMD ["node", "thumbnail-worker.mjs"]
