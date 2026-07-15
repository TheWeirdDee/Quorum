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
- **Durable database required.** For the current Render Free deployment,
  use a free Neon PostgreSQL project and set Render's `DATABASE_URL` to its
  **pooled** `postgresql://...` connection string. Quorum creates its five
  tables automatically on boot. Local development can keep using
  `file:./quorum.db`. A paid host may instead mount a disk at `/app/data`
  and use `file:/app/data/quorum.db`.
- **Env vars**: everything in `.env.example` — `CROO_API_KEY` above all;
  `REPO_DOCTOR_SERVICE_ID`/`VERIS_SERVICE_ID`/`ESCALATION_AGENT_SERVICE_ID`
  confirmed live and current; `CROO_SIMULATE=false` only once you mean to
  spend real USDC.
- **Process type**: background worker, not a web service, by default — it
  opens an outbound CROO WebSocket, it doesn't listen on a port. On Render
  this is a "Background Worker"; Railway/Fly just don't need a
  health-check port bound. **Exception**: if `DASHBOARD_API_KEY` is set
  (§3, Option B), the worker also binds `DASHBOARD_API_PORT` (default
  8080) and needs a routable public URL — deploy it as a Web Service
  instead, and open/expose that port.

```
docker build -t quorum-agent -f agent/Dockerfile agent
docker run -e CROO_API_KEY=... -e DATABASE_URL=postgresql://... quorum-agent
```

### Exact Render Free + Neon setup used by this project

1. In Neon, create project **Quorum**; PostgreSQL 18 is supported, leave
   Neon Auth off, and choose the region closest to the Render service.
2. On Neon's **Connect** screen choose the pooled connection and copy the
   `postgresql://...` URL. Treat it as a password; never commit it.
3. Render → **Quorum → Environment**: add/replace `DATABASE_URL` with that
   full URL, then save. Do not append `file:`.
4. Deploy the repaired GitHub `main` branch. The worker runs the schema
   migration before opening CROO or spending USDC.
5. Render Free can still sleep. Neon preserves all state while it sleeps.
   For better availability, an uptime monitor may request
   `https://quorum-veht.onrender.com/health` periodically; that endpoint is
   deliberately public and returns only `{ "ok": true }`.

## 3. Dashboard — one real architectural decision before you deploy it

The dashboard (`src/lib/db.ts`) currently reads `agent/quorum.db` as a
**local file on the same filesystem**. That's correct and fast for local
dev (`npm run dev` at the repo root, agent running alongside), but it means
the dashboard can only be deployed **co-located with the agent's disk** —
not on Vercel talking to an agent running elsewhere, since Vercel functions
share no filesystem with a Render/Railway/Fly volume.

Two options, both built now:

- **A — co-locate (fastest, zero extra setup).** Run the dashboard as a
  second process/service on the SAME host as the agent worker, both
  pointed at the same mounted volume. Leave `DASHBOARD_API_KEY` /
  `QUORUM_AGENT_API_URL` unset — the dashboard's two API routes fall back
  to reading `agent/quorum.db` directly.
- **B — dashboard on Vercel, worker elsewhere.** The worker exposes a
  minimal read-only HTTP API (`agent/src/api/server.ts`, plain
  `node:http`, two routes: `GET /decisions`, `GET /repos`) that the
  dashboard's API routes proxy to instead of touching the filesystem.
  Setup:
  1. **Agent-side** (`agent/.env` or the worker host's env): set
     `DASHBOARD_API_KEY` to a real secret. `DASHBOARD_API_PORT` defaults
     to 8080. Redeploy as a Web Service (see §2's exception above) so the
     port is actually reachable.
  2. **Dashboard-side** (Vercel project env vars — NOT `agent/.env`): set
     `QUORUM_AGENT_API_URL` to the worker's public URL. On this Render
     service use `https://quorum-veht.onrender.com` (no `:8080`); set
     `QUORUM_AGENT_API_KEY` to the *same* secret
     as `DASHBOARD_API_KEY`.
  3. Verified locally end-to-end: started the read API standalone against
     the real seeded `quorum.db`, confirmed a bare request 401s, a
     wrong-key request 401s, and an authorized request returns the exact
     JSON shape the dashboard already expects (agent/test/api/server.test.ts,
     7 tests). The dashboard-side proxy itself (fetch → pass-through) is a
     thin enough layer that this coverage stands in for a full
     cross-deploy integration test.

## 4. What's still unverified

- No real `docker build` has been run in this environment (Docker itself
  isn't installed here) — verified equivalently via `npx tsc -p
  tsconfig.json` + running the compiled output directly under `node`,
  which exercises the same compile-then-run path the image does.
- The Neon code path is typechecked and the cross-database schema/store is
  covered locally, but the real Neon connection cannot be exercised until
  its private `DATABASE_URL` is added directly in Render.
- Whichever host you pick, confirm the wallet is funded for the maximum
  policy-bounded outbound path (not merely non-zero) and
  `CROO_SIMULATE=false` is set deliberately before the first real order —
  see SDK_NOTES.md item 20 for exactly the incident this guards against.
