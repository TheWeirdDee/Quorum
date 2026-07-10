# Deploying Quorum

## 1. Agent Store listing (prerequisite — do this first)

The worker can't serve real orders without a real SDK-Key. This is a manual
step on CROO's own site — nothing here can do it for you:

1. `https://agent.croo.network/` — sign in (wallet, Google, or email).
2. **My Agents → Register Agent** — name it, submit. This mints the agent's
   AA wallet + DID.
3. **Copy the API Key immediately** — shown once, right after registration.
   This is `CROO_API_KEY`.
4. On the **Configure** page that follows: fill in the description + 1-5
   skill tags, then **+ Add Service** to register `quorum.register` — price,
   description, SLA, deliverable format **Schema** (matches
   `quorum.decision.v1`), requirements format **Schema** (matches
   `schemas/quorum.request.schema.json`).
5. Fund the **AA Wallet Address** (shown on Configure) with USDC on Base —
   not the Controller/Executor address.
6. Put the key in `agent/.env` as `CROO_API_KEY`.

Also confirm liveness of Repo Doctor, VERIS, and the escalation agent in the
Agent Store the morning of the demo (README.md's checklist) — a hired agent
going offline is the top project risk, not anything in this repo.

## 2. Agent worker — Render / Railway / Fly

`agent/Dockerfile` is a multi-stage build (tsc compile -> slim runtime,
no TS toolchain in the final image), verified locally: `npx tsc -p
tsconfig.json` compiles clean and the compiled output runs under plain
`node` with no module-resolution errors.

- **Build context**: `agent/` (the Dockerfile assumes it, not the repo root).
- **Persistent volume required** at `/app/data` — the image sets
  `DATABASE_URL=file:/app/data/quorum.db` itself. Without a mounted volume,
  `seen_events`/`decisions`/`orders` reset on every deploy, which silently
  breaks FR-6's dedupe (an event already "seen" would re-fire the whole
  pipeline, including real CAP spend, on next boot).
- **Env vars**: everything in `.env.example` — `CROO_API_KEY` above all;
  `REPO_DOCTOR_SERVICE_ID`/`VERIS_SERVICE_ID`/`ESCALATION_AGENT_SERVICE_ID`
  confirmed live and current; `CROO_SIMULATE=false` only once you mean to
  spend real USDC.
- **Process type**: background worker, not a web service — it opens an
  outbound CROO WebSocket, it doesn't listen on a port. On Render this is a
  "Background Worker"; Railway/Fly just don't need a health-check port bound.

```
docker build -t quorum-agent -f agent/Dockerfile agent
docker run -e CROO_API_KEY=... -v quorum-data:/app/data quorum-agent
```

## 3. Dashboard — one real architectural decision before you deploy it

The dashboard (`src/lib/db.ts`) currently reads `agent/quorum.db` as a
**local file on the same filesystem**. That's correct and fast for local
dev (`npm run dev` at the repo root, agent running alongside), but it means
the dashboard can only be deployed **co-located with the agent's disk** —
not on Vercel talking to an agent running elsewhere, since Vercel functions
share no filesystem with a Render/Railway/Fly volume.

Two honest options, not silently picked for you:

- **A — co-locate for the demo (fastest, zero new code).** Run the
  dashboard as a second process/service on the SAME host as the agent
  worker, both pointed at the same mounted volume (e.g. two Render
  services attached to one persistent disk, or both processes in one
  container behind a tiny supervisor). Matches everything already built.
- **B — dashboard on Vercel, per the original README/PRD plan.** Requires
  a small addition not yet built: a read-only HTTP endpoint on the agent
  worker exposing `decisions`/`repos` as JSON, with the dashboard's two API
  routes switched from `better-sqlite3` file reads to `fetch()` against
  that endpoint (env-gated, so local dev keeps the direct file read). Real
  but small — say if you want this built next.

Given the timeline, **A is the pragmatic default**; I haven't built B
because it's genuine new scope, not a Dockerfile detail.

## 4. What's still unverified

- No real `docker build` has been run in this environment (Docker itself
  isn't installed here) — verified equivalently via `npx tsc -p
  tsconfig.json` + running the compiled output directly under `node`,
  which exercises the same compile-then-run path the image does.
- Whichever host you pick, confirm the wallet is funded and
  `CROO_SIMULATE=false` is set deliberately before the first real order —
  see SDK_NOTES.md item 20 for exactly the incident this guards against.
