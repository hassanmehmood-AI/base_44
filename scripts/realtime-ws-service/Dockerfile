# Candidate Railway service for the Socket.IO realtime layer — NOT yet
# wired up as a Railway service (no production service created; this file
# exists for review as part of the Phase 1-3 implementation, per the
# explicit instruction not to deploy until approved).
#
# Root Directory on Railway (when approved): scripts/realtime-ws-service
# Required env vars: PORT (Railway sets this automatically), WS_AUTH_SECRET
# (shared with the main app's WS_AUTH_SECRET — never the same value as
# AUTH_SECRET or CRON_SECRET), CRM_BASE_URL (the main app's public origin,
# for CORS), DATABASE_URL (the same Postgres instance — LISTEN only, this
# service never writes).
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY auth.ts server.ts tsconfig.json ./
EXPOSE 8080
CMD ["npx", "tsx", "server.ts"]
