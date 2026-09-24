FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY scripts ./scripts
COPY migrations ./migrations
COPY chat-migrations ./chat-migrations
RUN mkdir /data
CMD ["sh", "-c", "node scripts/migrate.mjs && node scripts/migrate-chat.mjs && exec node scripts/fixtures/maintenance/server.mjs"]
