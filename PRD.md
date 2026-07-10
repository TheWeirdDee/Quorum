# Quorum — Product Requirements Document

**Version:** 1.0 · **Date:** 2026-07-02 · **Owner:** TheWeirdDee
**Target:** CROO Agent Hackathon (deadline 2026-07-12) · **Network:** Base Mainnet (chainId 8453) · **Settlement:** USDC via CAP

---

## 1. Summary

**Quorum** is an event-driven autonomous agent on the CROO Agent Protocol (CAP) that watches a repository's software supply chain and answers the one question a developer actually needs when a dependency changes: **"Should I keep shipping this in production?"**

When a meaningful trust event fires (a malicious release, a new CVE, a maintainer change, an abandonment, a license flip), Quorum first decides **whether the event is worth investigating**, then **convenes a quorum of independent specialist agents** — hiring each over CAP, in USDC — to assess it from different angles. It reconciles their verdicts, and **when they disagree, it autonomously purchases a tie-breaking opinion** until it reaches the confidence its risk policy demands. The output is a **defendable ship/don't-ship decision** with confidence, the disagreement made explicit, and on-chain receipts for every opinion it bought.

The product is not the security check. Repo Doctor already sells a repo health check for $0.01. **Quorum's product is the reconciliation and the economic decision** — buying certainty only when it's justified. That behavior is impossible on a normal API marketplace.

---

## 2. Problem

Modern software depends on hundreds of third-party packages that change constantly. Existing tooling (Dependabot, Snyk, Socket) runs static rules and emits **reports**. None of them make a **decision**, and none reflect how humans actually establish trust for high-stakes calls — through **independent, adversarial opinions** (peer review, second opinions, auditor vs management), not a single pipeline.

When an advisory drops at 2am, a developer doesn't want a report. They want: *given everything, keep it or pull it?* — and they'd trust that answer more if it came from multiple independent experts who were made to reconcile.

---

## 3. Goals & non-goals

### Goals
- G1. Turn a supply-chain event into a **ship/don't-ship decision** with a confidence score.
- G2. Compose **≥2 independent, live CROO agents** per investigated event, with a **third bought only on disagreement**.
- G3. Make **autonomous economic decisions**: whether to spend at all (Risk Gate) and how much to spend to reach a confidence target (Escalation), bounded by a budget cap.
- G4. Emit **verifiable proof** — on-chain receipts for every opinion purchased.
- G5. A **2-minute live demo** where a seeded malicious release drives real CAP orders end to end.

### Non-goals
- N1. Recurring/subscription billing — CAP is per-order; "continuous" = an event loop that fires per-event orders.
- N2. Broad ecosystem coverage — MVP runs the full pipeline on **npm** only; others are discovered-and-displayed.
- N3. Replacing security professionals — Quorum makes a first-pass decision and shows its evidence; humans stay in the loop.
- N4. Building the specialist checks ourselves — Quorum orchestrates independent agents; that independence is the point.

---

## 4. Users & value

| User | Pain today | Quorum value |
|---|---|---|
| Developer / small team | Advisories are noise; unclear if action is needed | One decision, only alerted when it matters, $0 when it doesn't |
| Security engineer | Single-tool verdicts miss trust/provenance signals | Two independent lenses reconciled; disagreement surfaced |
| Autonomous agent (buyer) | Needs a machine-readable ship/no-ship gate in its own pipeline | Callable CAP service returning a structured decision |

**"Still useful if CROO disappeared tomorrow"** — yes: this is Snyk/Socket territory. CAP is the implementation detail that makes the independent multi-opinion composition cheap and verifiable.

---

## 5. How judging maps to the build (CROO rubric)

| Axis | Weight | How Quorum wins it |
|---|---|---|
| Technical Execution | 30% | Dual-role CAP (provider + requester) on one socket; correct state handling; the continuous loop throws off 10+ real orders |
| A2A Composability | 25% | Convenes multiple **independent, other-team** live agents; escalation adds depth; diversity is structural, not self-dealt |
| Innovation | 20% | Autonomous spend-to-resolve-uncertainty — impossible on a normal API marketplace |
| Usability & Adoption | 15% | Real buyer (developers), real recurring orders from one registration, clean "$0 when nothing happens" model |
| Presentation | 10% | Live 2-min demo: seeded event → agents disagree → autonomous $0.03 tie-break → decision + receipts |

**Anti-sybil:** Quorum hires other teams' agents through genuine need (each event requires the opinions), clearing the ≥3-counterparty / ≥5-buyer-wallet thresholds organically rather than via self-trade. Use a distinct buyer key for outbound hires so counterparties count as unique.

---

## 6. Functional requirements

### 6.1 Provider interface (Quorum as a callable agent)
- FR-1. Expose one service, `quorum.register`, taking a repo URL + risk policy (+ optional budget cap, notify target). Schema: `schemas/quorum.request.schema.json`.
- FR-2. Validate requirements with Zod at negotiation; `rejectNegotiation` on malformed input **before** the buyer locks funds.
- FR-3. Cache `negotiation.requirements` by `orderId` at accept time (buyer input is not on `order_paid`).
- FR-4. On `order_paid`, run a baseline scan and `deliverOrder` a `quorum.decision.v1` (schema: `schemas/quorum.decision.schema.json`).

### 6.2 Event detection (our code)
- FR-5. Resolve a repo's npm dependencies; poll OSV, GitHub REST/Advisory, and the npm registry.
- FR-6. Normalize to a `TrustEvent` and dedupe by `(dependency, type, ref)` so each event fires once.
- FR-7. Persist repos, dependencies, seen_events, decisions, and orders.

### 6.3 Risk Gate (spend / don't-spend, before any money)
- FR-8. Classify each event as **archive ($0)** or **investigate**. Patch/low/info → archive; malicious_release / critical|high CVE / maintainer_change on a used dep / repo_archived / restrictive license_change → investigate; ambiguous → defer to policy.
- FR-9. Record and expose the gate decision even when nothing is spent.

### 6.4 Orchestration (requester side) — structural split
- FR-10. **Repo Doctor = HEALTH lens** ("technically healthy?"), never trust. Input: the dependency's GitHub repo (map npm→GitHub first). Normalize to `healthy|mixed|unhealthy`.
- FR-11. **VERIS = TRUST lens** ("trustworthy?"), never code health. Input: repo URL + npm homepage + event ref. Normalize to `trusted|caution|high_risk`.
- FR-12. Merge via the health×trust matrix (§6 of SPEC) → decision + confidence.
- FR-13. Handle hired-agent timeout/failure without hanging; degrade gracefully.

### 6.5 Escalation (buy certainty)
- FR-14. If `confidence < policy.target` AND `spend + next_cost ≤ budget_cap` AND a third opinion could resolve the uncertainty (both lenses returned verdicts — there is a concrete question to fact-check), buy **one** additional independent opinion from the configured escalation agent, then recompute. Cap escalations (default 1). *(Clarified 2026-07-03: sub-target confidence alone triggers escalation — not only the health×trust disagreement cell, as an earlier M2 reading had it. See SDK_NOTES item 25.)*
- FR-15. If budget is exhausted before target: alert with **honest** confidence, never a fabricated high number.
- FR-16. Escalation agent is an **env slot** — must be a confirmed-live agent (a Research/Report agent, or ChainGuard for web3 deps). If none live, degrade to enriched re-query / honest sub-target confidence.

### 6.6 Decision & notification
- FR-17. Produce `quorum.decision.v1`: dependency, event, gate, decision, confidence, per-lens verdicts (+order_id/tx/cost), escalation block, plain-English disagreement, total spend, receipts.
- FR-18. Push the decision to a Slack webhook (demo notifier).
- FR-19. Every receipt is a real on-chain settlement tx. Never present mock hashes as real.

### 6.7 Dashboard (demo surface)
- FR-20. Live view: event feed, per-hire CAP order cards with tx links, a disagreement panel, a spend + confidence meter, final decision. (Built next; React + frontend-design skill.)

---

## 7. Non-functional requirements
- NFR-1. `npx tsc --noEmit` clean before every commit; Zod at every boundary.
- NFR-2. Redacting logger scrubs SDK keys from all output.
- NFR-3. `USE_FIXTURES=true` runs the full engine offline against `fixtures/` (no spend).
- NFR-4. `CROO_SIMULATE=true` dry-runs the lifecycle without real USDC.
- NFR-5. Deployable: provider/worker to a persistent host (Render/Railway/Fly, Dockerfile); dashboard to Vercel.
- NFR-6. All agent IDs, prices, keys, sources configurable via env.

---

## 8. System design (summary)
```
register(repo, policy) → index deps → POLL LOOP
  detect TrustEvent → dedupe → RISK GATE
     ├ archive ($0)
     └ investigate → hire Repo Doctor (health) + VERIS (trust)  [CAP orders]
           → merge → confidence
              ├ ≥ target → DECIDE
              └ < target & budget left → ESCALATE (buy 1) → DECIDE
        → quorum.decision.v1 → notify → receipts → sleep
```
Two roles (provider + requester) share one WebSocket; an order-ID map separates orders-served from orders-bought. Full detail in `SPEC.md`.

---

## 9. Confirmed live counterparties (validate morning-of-demo)
| Agent | Role | Status seen | Note |
|---|---|---|---|
| Repo Doctor | Health lens | LIVE, 100% completion | Takes a GitHub repo URL |
| VERIS | Trust lens | LIVE, ~98% completion | "weak inputs = limited findings" — pass full context |
| Escalation (slot) | Tie-breaker | **must confirm** | Research/Report agent, or ChainGuard for web3 deps; graceful-degrade if none |

**Liveness is the top project risk.** The demo hires these live; confirm both core agents are online and recently active before Demo Day, and keep a recorded successful run as fallback.

---

## 10. Scope & milestones (10 days)
- **M1 (D1–2):** Scaffold, config, state store, Event Detector (npm/OSV/GitHub) + fixtures passing.
- **M2 (D3–4):** Risk Gate + merge/confidence matrix, unit-tested against `fixtures/expected/`.
- **M3 (D5–6):** Requester integration (hire Repo Doctor + VERIS live), npm→GitHub resolver, normalization adapters verified against a real call.
- **M4 (D7):** Escalation engine + budget guard; confirm escalation agent live.
- **M5 (D8):** Provider interface (`quorum.register`), Agent Store listing, dashboard.
- **M6 (D9):** Demo harness + seeded event, Slack notifier, deploy, record fallback run.
- **M7 (D10):** BUIDL writeup, 5-min video, README, buffer.

**Definition of done:** a registered repo, on a seeded malicious release, produces a live `DO_NOT_SHIP` via real CAP orders to Repo Doctor + VERIS (+ escalation), with real receipts, a Slack alert, and total spend shown — `tsc` clean, deployed, reachable.

---

## 11. Open risks
| Risk | Mitigation |
|---|---|
| A hired agent offline at demo | Confirm liveness morning-of; recorded fallback run; graceful degrade |
| No suitable third specialist live | Escalation degrades to enriched re-query / honest sub-target confidence — adaptive spend is the innovation, not the count |
| Real SDK signatures differ from reconstructed names | First build step: `npm install`, inspect types, correct in code |
| Event Detector underestimated (the real spine) | Scope to npm-only for full pipeline; discover-and-display the rest |
| "Looks like another scanner" | Lead every surface with the decision + disagreement + spend story, never the underlying check |

---

## 12. Reference
Behavioral spec: `SPEC.md` · Build prompt: `AGENT_PROMPT.md` · Schemas: `schemas/` · Test fixtures & matrix: `fixtures/SCENARIOS.md` · Config: `.env.example`
