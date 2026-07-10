# Supply Chain Quorum

An **autonomous trust broker** for your software supply chain, built on the CROO Agent Protocol (CAP).

Register a repo once. Quorum watches its dependencies for trust events (malicious releases, new CVEs, maintainer changes, abandonment, license flips). When something meaningful happens, it **decides whether the event is worth investigating**, then hires independent specialist agents to answer two different questions —

- **Repo Doctor** → *Is this dependency technically healthy?*
- **VERIS** → *Is this project/publisher trustworthy?*

— reconciles engineering-health against supply-chain-trust, and when they disagree, **autonomously spends a little more USDC to buy certainty** (governed by a risk policy) before returning the one answer a developer actually needs:

> **Should I keep shipping this dependency in production?**

A decision, with confidence and on-chain receipts. Not a report. It only spends money when additional expert analysis is economically justified — which is a thing that can't exist on a normal API marketplace.

## This handoff package
| File | Purpose |
|---|---|
| `SPEC.md` | The full build spec — vision, architecture, event loop, risk gate, orchestration, escalation, demo script. |
| `AGENT_PROMPT.md` | Paste-into-Claude-Code build prompt: ground rules, incremental build order, definition of done. |
| `schemas/quorum.request.schema.json` | Provider input (register a repo). |
| `schemas/quorum.decision.schema.json` | The `quorum.decision.v1` deliverable. |
| `.env.example` | All configuration — CROO keys, hired-agent service IDs, event sources, notifications. |

## Before you build — three liveness checks
The whole design depends on real, callable counterparties. Confirm in the Agent Store, the morning of the demo:
1. **Repo Doctor** — LIVE, recent activity.
2. **VERIS** — LIVE, recent activity.
3. **Escalation agent** — pick a live Research/Report agent (or ChainGuard for web3 deps) and set `ESCALATION_AGENT_SERVICE_ID`. If none is live, the graceful-degrade path (honest sub-target confidence) still works — adaptive spend is the innovation, not the agent count.

## Stack
TypeScript · Node 20 · `@croo-network/sdk` · Base mainnet (USDC) · SQLite→Postgres · Slack webhook · deploy provider/worker to Render/Railway/Fly, dashboard to Vercel.

## Scope
Pitch: "we monitor your software supply chain." MVP: **npm + GitHub** run the full economic pipeline; Python/Docker/Actions are discovered-and-displayed. Depth in the decision engine beats breadth in ecosystem coverage — that's where the rubric points.
