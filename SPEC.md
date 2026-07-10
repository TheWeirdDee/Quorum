# Supply Chain Quorum — Build Spec

**One-liner:** An event-driven autonomous agent that watches a repository's software supply chain and, when a meaningful trust event fires, *decides whether the event is worth investigating*, buys independent assessments from specialist CROO agents, reconciles engineering-health vs supply-chain-trust, and returns a defendable **ship / don't-ship decision** — spending USDC only when additional certainty is economically justified.

**It is not a scanner.** Repo Doctor already sells a repo health check for $0.01. This agent sits *above* specialists and does the thing none of them do: an autonomous **trust broker** that decides *when evidence is worth buying*, purchases it over CAP, and produces a decision with confidence and receipts.

---

## 1. Vision

### Problem
Developers ship code that depends on hundreds of third-party packages. The supply chain changes constantly — new releases, new maintainers, published CVEs, abandoned projects, license flips, compromised versions. Existing tools (Dependabot, Snyk, Socket) run static rules and produce reports. Nobody answers the only question a developer actually cares about at 2am when an advisory drops:

> **"Should I keep shipping this dependency in production, right now?"**

That is a *decision*, not a report — and a good decision needs more than one opinion.

### Why CROO / CAP is required (the Innovation axis: "impossible on a normal API marketplace?")
A normal API marketplace cannot do the core behavior of this product: **an autonomous agent that decides, on its own, to spend money to reduce its own uncertainty.**

- It hires *independent* specialist agents it does not own, over a permissionless protocol.
- It pays them per-assessment in USDC, on-chain, with escrow and verifiable receipts.
- It makes an *economic* decision — spend / don't spend, and how much — governed by a risk policy.

No REST API gives you permissionless discovery + trustless settlement + independent counterparties. The "buy another opinion for $0.03 because confidence is below the enterprise threshold" moment is only possible in an agent economy.

### Why this isn't just Repo Doctor
| | Repo Doctor | VERIS | **Quorum (this build)** |
|---|---|---|---|
| Answers | "Is this repo technically healthy?" | "Is this project/publisher trustworthy?" | **"Should I keep shipping this in production?"** |
| Output | Report | Report | **Decision + confidence + receipts** |
| Trigger | On demand | On demand | **Autonomous, event-driven** |
| Spends money | No | No | **Yes — only when justified** |

Quorum's product is the **reconciliation + economic decision**, not the underlying checks.

---

## 2. Architecture

### Components
1. **Provider Interface** — Quorum is itself a callable CAP agent. A human/agent registers a repo and a risk policy; Quorum returns (and later pushes) decisions.
2. **Event Detector** *(the engineering spine — all our own code)* — polls public sources (GitHub API, OSV, npm advisories) for the repo's dependencies and emits normalized `TrustEvent`s.
3. **Risk Gate** — for each event, decides **"is this worth paying to investigate?"** before any money moves. Cheap/irrelevant events are archived at $0.
4. **Orchestrator (Requester side)** — for events that pass the gate, hires **Repo Doctor** (health lens) and **VERIS** (trust lens) over CAP, merges results, computes confidence.
5. **Escalation Engine** — if confidence is below the policy target, buys one more independent opinion, up to a budget cap.
6. **Decision + Notifier** — produces the `quorum.decision.v1` artifact, pushes an alert (Slack webhook for the demo), attaches every CAP receipt.

### Event loop (steady state)
```
register(repo, policy)
      ↓
index dependencies  ──────────────┐
      ↓                           │  (persisted)
  ┌───────── poll loop ───────────┘
  │   GitHub releases / OSV / npm advisories
  │           ↓
  │      normalize → TrustEvent
  │           ↓
  │      dedupe (seen before? skip)
  │           ↓
  │      ┌── RISK GATE ──┐
  │      │ worth paying? │
  │      └──┬────────┬───┘
  │      no │        │ yes
  │   archive       hire Repo Doctor  (CAP order, ~$0.01)
  │   ($0)          hire VERIS         (CAP order, ~$0.10)
  │                       ↓
  │                 merge + confidence
  │                       ↓
  │                 below policy target?
  │                   ├─ yes → ESCALATE (buy 1 more, ≤ cap)
  │                   └─ no  → decide
  │                       ↓
  │                 DECISION + notify + receipts
  └────────── sleep ──────────
```

### CAP interactions (two roles on one connection)
Quorum is simultaneously:
- **Provider** — receives `register-repo` orders from users/agents. (`order_negotiation_created` → `acceptNegotiation` → `order_paid` → `deliverOrder`.)
- **Requester** — hires Repo Doctor / VERIS / escalation agent. (`negotiate → pay → getDelivery`.)

Distinguish inbound (served) from outbound (bought) orders by tracking negotiation/order IDs in a local map. This is the single trickiest integration detail — see §6.

---

## 3. Provider Schema

Quorum exposes **one service**: `quorum.register`.

### Request (buyer → Quorum), lives in `negotiation.requirements`
See `schemas/quorum.request.schema.json`. Shape:
```json
{
  "repo": "https://github.com/owner/name",
  "ecosystems": ["npm", "pypi"],
  "risk_policy": "enterprise",
  "budget_cap_usdc": 0.25,
  "notify": { "type": "slack", "webhook": "https://hooks.slack.com/..." }
}
```
- `risk_policy` ∈ `startup` | `balanced` | `enterprise` (see §5 for what each means).
- `budget_cap_usdc` — hard ceiling on total spend **per event**.

### Response / Deliverable (`quorum.decision.v1`)
See `schemas/quorum.decision.schema.json`. Delivered on the initial `register` order as a baseline scan, and pushed on every subsequent triggered event. Shape:
```json
{
  "schema": "quorum.decision.v1",
  "dependency": "left-pad@1.3.0",
  "event": { "type": "malicious_release", "detail": "…", "source": "osv", "ref": "GHSA-…" },
  "decision": "DO_NOT_SHIP",
  "confidence": 0.94,
  "lenses": {
    "health":  { "agent": "Repo Doctor", "verdict": "healthy",  "order_id": "…", "tx": "0x…", "cost_usdc": 0.01 },
    "trust":   { "agent": "VERIS",       "verdict": "high_risk", "order_id": "…", "tx": "0x…", "cost_usdc": 0.10 }
  },
  "escalation": { "triggered": true, "agent": "<escalation agent>", "order_id": "…", "tx": "0x…", "cost_usdc": 0.03, "reason": "health/trust disagreement, confidence 0.63 < policy target 0.90" },
  "disagreement": "Repo Doctor sees an active, well-tested repo; VERIS flags a publisher-ownership change and dropped trust score.",
  "total_spend_usdc": 0.14,
  "receipts": ["0x…", "0x…", "0x…"],
  "decided_at": "2026-07-05T10:14:32Z"
}
```

### CAP interface (provider side)
Register the service in the Agent Store dashboard to obtain the SDK-Key. Provider runtime:
- `connectWebSocket()` → subscribe to `order_negotiation_created`, `order_paid`.
- On negotiation: `getNegotiation(id)`, validate the requirements payload with Zod; `acceptNegotiation(id)` if valid, else `rejectNegotiation(id, reason)` **before** the buyer locks funds.
- **Cache `negotiation.requirements` keyed by `orderId` at accept time** (with `getOrder` → `getNegotiation` fallback) — the buyer's input is NOT on the `order_paid` event.
- On `order_paid`: run baseline scan → `deliverOrder(id, { deliverableType: "schema", deliverableSchema: <decision> })`.
- On unrecoverable failure: `rejectOrder(id, reason)` to release escrow.

> ⚠️ **SDK verification required.** The method names above are reconstructed from live CROO agents' public write-ups and the protocol docs. Before building, run `npm install @croo-network/sdk`, open its types, and confirm exact signatures for both provider and **requester** (buyer) calls. Correct any mismatches in the code, not the concept.

---

## 4. Event Detection *(our code — the real engineering spine)*

For each registered repo, resolve its dependency manifests, then poll:

| Source | Detects | API | Auth |
|---|---|---|---|
| **OSV.dev** | CVEs / advisories per package+version | `POST https://api.osv.dev/v1/query` | keyless |
| **GitHub Advisory (GraphQL)** | security advisories, severity | GitHub API | token (free PAT) |
| **GitHub REST** | new releases, repo archived, default-branch/owner changes, commit cadence | `/repos/{o}/{r}/releases`, `/repos/{o}/{r}` | token |
| **npm registry** | new version published, deprecations, maintainer list changes | `https://registry.npmjs.org/{pkg}` | keyless |
| **PyPI (stretch)** | new release, yanked versions | `https://pypi.org/pypi/{pkg}/json` | keyless |

### Normalized `TrustEvent`
```json
{ "dependency": "pkg@version", "type": "malicious_release|new_cve|maintainer_change|repo_archived|license_change|abandonment|suspicious_cadence|deprecation",
  "severity_hint": "critical|high|medium|low|info", "source": "osv|github|npm", "ref": "GHSA-…|CVE-…|url", "observed_at": "…" }
```

### Polling cadence & dedupe
- MVP: poll every N minutes (config). Persist a `seen_events` set keyed by `(dependency, type, ref)` so an event fires the pipeline **once**.
- State store: SQLite/Postgres (repos, dependencies, seen_events, decisions).

**Scope for 10 days:** run the *full* Risk-Gate→hire→decide pipeline on **npm dependencies only**. Discover Python/Docker/Actions assets and display them as "monitored — no action," so the platform *looks* complete without ten pipelines. (See §9.)

---

## 5. Risk Gate + Budget Policy

### Risk Gate — "is this event worth paying to investigate?" (runs BEFORE any spend)
Deterministic first pass, no money spent:
- `patch` release, `info`/`low` severity, deprecation notice with a maintained successor → **archive, $0.**
- `malicious_release`, `critical`/`high` CVE, `maintainer_change` on a widely-used dep, `repo_archived`, `license_change` to a restrictive license → **investigate (spend).**
- Ambiguous → gate defers to policy (enterprise investigates more aggressively than startup).

The Gate is itself an autonomous economic decision and should be logged/shown: *"Event classified LOW — no external analysis purchased. Cost: $0."*

### Risk policies (set by the buyer at register time)
| Policy | Confidence target | Escalation | Budget cap/event | Behavior |
|---|---|---|---|---|
| `startup` | 0.70 | rarely | $0.05 | Minimize spend; alert only on clear high risk. |
| `balanced` | 0.80 | on disagreement | $0.15 | Default. |
| `enterprise` | 0.90 | on any uncertainty | $0.25 | Buy certainty before alerting. |

The **policy chooses how much certainty to buy** — the user does not micromanage per-call. That's the autonomous-commerce story.

---

## 6. Agent Orchestration (Requester side)

### Repo Doctor — HEALTH lens
- Confirmed live: service **"Repo Health Check"**, ~$0.01, SLA <5min, 100% completion.
- **Input:** a GitHub repo URL. So map `npm package → its GitHub repo` first (npm registry JSON exposes `repository.url`; normalize `git+https`, strip `.git`).
- **Returns:** README quality, test-coverage presence, outdated dependencies, commit hygiene → normalize to `verdict ∈ {healthy, mixed, unhealthy}`.
- **Never used for:** trustworthiness. (Structural split — see below.)

### VERIS — TRUST lens
- Confirmed live: due-diligence / trust reports, ~$0.10, ~98% completion. Categories: Data & Analytics, Research & Report.
- **Input:** project identity/link + the specific suspicious signal from the event. VERIS notes "weak inputs = limited findings; include official project link" — so pass the repo URL + package homepage + the event ref.
- **Returns:** publisher/maintainer reputation, provenance, suspicious signals, trust score → normalize to `verdict ∈ {trusted, caution, high_risk}`.
- **Never used for:** technical code health.

> **The split is structural, not accidental.** Repo Doctor answers *"technically healthy?"*; VERIS answers *"trustworthy?"*. Disagreement (e.g. healthy repo + ownership-change trust flag) is **expected and meaningful**, not noise. The orchestrator reconciles *engineering quality vs supply-chain trust* — that's the product.

### Merge logic → confidence
Map the two verdicts to a decision + confidence. Recommended matrix (tune during build):

| Health \ Trust | trusted | caution | high_risk |
|---|---|---|---|
| **healthy** | SHIP (0.95) | REVIEW (0.75) | **disagreement → escalate (0.60)** |
| **mixed** | REVIEW (0.75) | REVIEW (0.65) | DO_NOT_SHIP (0.85) |
| **unhealthy** | REVIEW (0.70) | DO_NOT_SHIP (0.85) | DO_NOT_SHIP (0.97) |

Confidence = distance from the decision boundary; the "healthy + high_risk" cell is the classic disagreement that drives escalation.

### The trickiest integration detail (from a live agent's write-up)
Buyer requirements live in `negotiation.requirements`, **not** on the `order_paid` event. When Quorum acts as **provider**, cache requirements by `orderId` at accept time. When Quorum acts as **requester**, hold your own outbound context keyed by the outbound order ID and match deliveries back. Track inbound vs outbound orders in one map so the single WebSocket connection doesn't confuse "orders I serve" with "orders I buy."

---

## 7. Escalation Logic

Triggered when `confidence < policy.confidence_target` AND `spend_so_far + next_cost ≤ budget_cap`.

- Buy **one** additional independent opinion, then recompute. Cap the number of escalations (default 1) so cost stays bounded and the demo stays tight.
- Log the economic reasoning verbatim for display: *"Confidence 0.63 < target 0.90; budget remaining $0.14; purchasing one escalation for $0.03."*
- If budget is exhausted before target is met: **alert with the honest confidence** ("62% — unresolved: exploitability disputed"), never a fake high number.

### ⚠️ The escalation agent is a SLOT, not a confirmed counterparty
The "third opinion" must be a **real, live** agent — do not hardcode a phantom. Confirm liveness in the Agent Store before the demo and set `ESCALATION_AGENT` accordingly. Candidates by fit:
- A **Research & Report**-category agent that can investigate the specific advisory/CVE and break a health-vs-trust tie (VERIS itself may expose a deeper research service — check its service list).
- **ChainGuard** (contract security, confirmed live, 100%) — a *natural* tie-breaker **only when the dependency is a web3/on-chain package** with a contract address; not a fit for pure npm libs.
- If no suitable third specialist is live at demo time: degrade gracefully — escalation re-queries VERIS with enriched inputs, or the agent alerts with honest sub-target confidence. **The concept survives without a third agent** (adaptive spend is the innovation, not the count).

---

## 8. Demo Script (the 2-minute story)

Seeded event: **a malicious/compromised package release** (needs no explanation; judges get it instantly). Pre-seed a fixture so the pipeline fires live without waiting for a real CVE.

```
[on screen: Quorum dashboard, repo already registered, policy = enterprise]

10:14  Event Detector: "malicious version published — evil-dep@2.4.1"
        → TrustEvent { type: malicious_release, severity: critical, source: osv }

10:14  RISK GATE: "Critical + production dependency → worth investigating."
        (contrast: earlier a patch release was archived at $0 — show that line)

10:14  CAP ORDER → Repo Doctor        [live tx appears]   $0.01
       CAP ORDER → VERIS              [live tx appears]   $0.10

10:15  Repo Doctor: HEALTHY (active repo, tests present)
       VERIS:       HIGH TRUST RISK (publisher ownership changed, trust score dropped)
       → DISAGREEMENT. Confidence 0.63.

10:15  ENTERPRISE POLICY: target 0.90 > 0.63, budget remaining.
       → autonomously purchases escalation                [live tx]   $0.03

10:15  Confidence → 0.94.  DECISION: DO_NOT_SHIP.

10:15  Slack alert fired. Three CAP receipts displayed on-chain.
       Total autonomous spend: $0.14. Nobody touched anything.
```

The money-shot line for the pitch: *"Three independent agents, hired and paid autonomously, disagreed — the system detected the conflict, spent $0.03 to resolve it, and returned a decision with its receipts."*

### Demo prerequisites checklist
- [ ] Repo Doctor **and** VERIS confirmed LIVE + recently active in the Agent Store the morning of the demo.
- [ ] Escalation agent confirmed live (or graceful-degrade path rehearsed).
- [ ] Quorum's own agent wallet funded with USDC on Base.
- [ ] Seeded `malicious_release` fixture wired to fire on a keystroke/timer.
- [ ] A "$0 archived" low-severity event shown first, for contrast.
- [ ] Fallback recording of a successful live run, in case an agent is offline on stage.

---

## 9. Stretch Goals (post-MVP; architecture must not block these)
- Python (`requirements.txt` / `poetry.lock`) — second ecosystem, same pipeline.
- Docker base images, GitHub Actions pins, Terraform modules — new event sources, same gate/orchestrator.
- SBOM ingestion (CycloneDX / SPDX) as an input format.
- More CROO specialist agents as they list (widen the escalation pool → deeper A2A).
- Real recurring billing on top of CAP (out of scope for the hackathon — CAP is per-order).

---

## Scope discipline (read before building)
Depth beats breadth on this rubric. Spend the 10 days on the **Risk Gate → two-lens hire → disagreement → escalation** loop and the **live demo moment**, wired to **confirmed-live agents**. Discover many asset types (cheap, looks complete); run the *full economic pipeline* on **npm only**. Do not build ten manifest parsers. The score is in the decision engine and the authenticity of the A2A calls, not in ecosystem coverage.
