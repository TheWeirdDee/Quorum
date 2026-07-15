# Quorum agent (event detector, risk gate, orchestrator, CAP provider/requester worker).
# Build from the agent/ directory: `docker build -t quorum-agent -f Dockerfile .` (context = agent/).
# Runs `npm run worker` (scripts/worker.ts) — the always-on process that serves
# quorum.register orders and hires Repo Doctor/VERIS/Themis. See NFR-5 (PRD.md).

# ---- deps: install once, reused by both the build and runtime stages ----
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile TS -> JS (native-module-free at this stage; better-sqlite3's
# native binding is only needed at RUNTIME, not for tsc) ----
FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npx tsc -p tsconfig.json

# ---- runtime: production deps only + compiled output, no TS toolchain ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

# Local/paid-disk fallback. Render Free overrides DATABASE_URL with a durable
# Neon postgresql:// connection string, so its ephemeral filesystem is not
# part of the safety boundary.
VOLUME ["/app/data"]
ENV DATABASE_URL=file:/app/data/quorum.db

# Only bound when DASHBOARD_API_KEY is set (DEPLOY.md §3 option B — a
# dashboard deployed separately, e.g. Vercel). Harmless to expose otherwise;
# the process simply never listens on it.
EXPOSE 8080

CMD ["node", "dist/scripts/worker.js"]
