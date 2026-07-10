# Claude Code Build Prompt — Supply Chain Quorum

Paste this into Claude Code at the project root. Read `SPEC.md` alongside it — this prompt is the *how to build*, SPEC.md is the *what*.

---

You are building **Supply Chain Quorum**, a CROO Agent Protocol (CAP) agent, for a hackathon submission. Build on **Base Mainnet (chainId 8453)**, settle in **USDC**, gas is sponsored by CROO's Paymaster. Language: **TypeScript / Node.js 20**. SDK: **`@croo-network/sdk`**.

Full behavioral spec is in `SPEC.md`. Read it first. Then follow these build rules.

## Ground rules
1. **Verify the SDK before coding against it.** Run `npm install @croo-network/sdk`, inspect its exported types, and confirm the exact provider AND requester (buyer) method signatures. The SPEC's method names (`connectWebSocket`, `getNegotiation`, `acceptNegotiation`, `rejectNegotiation`, `getOrder`, `deliverOrder`, `rejectOrder`, and the buyer-side negotiate/pay/getDelivery) are reconstructed from public write-ups — treat them as a starting point and correct to match the installed version. Do not invent methods; if unsure, stop and surface the mismatch.
2. **Do not fabricate on-chain data.** No fake tx hashes, no mocked "completed" orders in anything that could look like real proof. If a call can't be made live, mark it clearly as a stub.
3. **Two roles, one connection.** Quorum is a provider (serves `quorum.register`) and a requester (hires Repo Doctor / VERIS / escalation). Maintain a single map distinguishing inbound orders (served) from outbound orders (bought) by order ID.
4. **Requirements caching.** Buyer input lives in `negotiation.requirements`, not on `order_paid`. Cache requirements by `orderId` at accept time (`getOrder` → `getNegotiation` fallback). A redacting logger must scrub the SDK key from all output.
5. **`npx tsc --noEmit` must pass before every commit.** Zod-validate every payload at both boundaries (inbound request, outbound deliverables, and the responses coming back from hired agents).
6. **Everything configurable via env** — no hardcoded agent IDs, service IDs, prices, or keys. See `.env.example`.

## Build order (incremental — each step must compile & be committed)
1. **Scaffold** — TS project, config module (Zod-validated env, reads `.env`), redacting logger, SQLite state store (repos, dependencies, seen_events, decisions, orders).
2. **Event Detector** — implement OSV query + npm registry poll + GitHub REST/Advisory poll for a given repo's npm deps. Emit normalized `TrustEvent`. Dedupe via `seen_events`. Unit-test with fixtures (incl. one seeded `malicious_release`).
3. **Risk Gate** — deterministic classifier: event → {archive $0 | investigate}. Log the decision. Unit-test the archive-vs-investigate boundary.
4. **npm→GitHub resolver** — map an npm package to its GitHub repo URL from registry JSON (normalize `git+https`, strip `.git`). Needed to call Repo Doctor.
5. **Requester integration** — hire Repo Doctor (health) and VERIS (trust) over CAP: negotiate → pay (USDC escrow) → getDelivery. Normalize each response to a verdict. Handle timeouts/failures (release/skip, never hang).
6. **Merge + confidence** — implement the health×trust matrix from SPEC §6 → decision + confidence.
7. **Escalation engine** — if `confidence < policy.target` and within `budget_cap`, buy one more opinion from `ESCALATION_AGENT`; recompute; cap escalations. Log the economic reasoning string.
8. **Provider interface** — expose `quorum.register`: accept negotiation, validate requirements (Zod), cache, on `order_paid` run a baseline scan and `deliverOrder` a `quorum.decision.v1`. Register the service in the Agent Store dashboard to get the SDK-Key.
9. **Notifier** — Slack webhook push of the decision + receipts.
10. **Continuous loop** — background worker: poll → gate → (hire → merge → escalate → decide) → notify → sleep. This is the process you deploy to a persistent host.
11. **Demo harness** — a command that injects the seeded `malicious_release` fixture and drives the full live pipeline for the 2-minute demo (SPEC §8). Include the "$0 archived low-severity event" line first, for contrast.
12. **Deploy** — provider/worker to a persistent host (Render/Railway/Fly; include Dockerfile). Static dashboard (if built) to Vercel.

## Schemas
Use `schemas/quorum.request.schema.json` and `schemas/quorum.decision.schema.json` as the source of truth for the provider boundary. Generate Zod schemas from these shapes.

## Do NOT
- Build Python/Docker/Terraform pipelines in the MVP — discover-and-display only (stretch).
- Hardcode a third "escalation" agent as if confirmed — it's an env slot; confirm liveness first.
- Add recurring-billing logic — CAP is per-order; the "subscription" is a continuous loop that fires per-event orders.

## Definition of done (MVP)
- A registered repo, on a seeded malicious release, produces a live `DO_NOT_SHIP` decision via real CAP orders to Repo Doctor + VERIS (+ escalation), with real receipts, a Slack alert, and total spend shown — driven by the demo harness, `tsc --noEmit` clean, deployed and reachable.
