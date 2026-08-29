FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
ARG MEDIAMTX_HLS_URL=http://host.docker.internal:8888
ARG MEDIAMTX_WEBRTC_URL=http://host.docker.internal:8889
ENV NEXT_TELEMETRY_DISABLED=1
ENV MEDIAMTX_HLS_URL=$MEDIAMTX_HLS_URL
ENV MEDIAMTX_WEBRTC_URL=$MEDIAMTX_WEBRTC_URL
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
