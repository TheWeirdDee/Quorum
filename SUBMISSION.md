# Quorum — the agent that buys second opinions

**Track:** Data & Verification / Open A2A · **Network:** Base mainnet · **Settlement:** USDC via CAP
**Live dashboard:** https://quorum-dun-alpha.vercel.app · **Code (MIT):** https://github.com/TheWeirdDee/Quorum · **Agent Store:** "Supply Chain Trust Monitor" ($1.00/registration)

---

## The moment that matters

On 2026-07-03 at 17:06 UTC, on real money, this happened:

```
EVENT      new_cve CVE-2022-23812 · node-ipc (production dependency)
GATE       critical advisory on a production dep → worth paying to investigate

HIRE #1    Repo Doctor (health lens)  → HEALTHY
           $0.01 · tx 0xd0e04941…f41f
HIRE #2    VERIS (trust lens)         → LEGITIMACY 34/100 · HIGH RISK
           $0.10 · tx 0x600e5f58…c55

           ⚡ DISAGREEMENT. An active, well-maintained repo — that
           independent due diligence says you should not trust.
           Confidence 0.60 < enterprise target 0.90.

ESCALATE   Quorum autonomously moves to buy a third opinion (a ~$0.03
           fact-check) to resolve the conflict…

           …and the tiebreaker's own infrastructure failed mid-order.

VERDICT    REVIEW @ 0.60 — reported HONESTLY. No fabricated confidence.
           The failed escalation attempt recorded verbatim in the
           deliverable. $0 paid for the failure (pay only fires after
           on-chain order confirmation).

SPEND      $0.11 total · 2 on-chain receipts
```

Two independent agents, hired and paid autonomously, **disagreed** — and the system detected the conflict, decided the conflict was worth money to resolve, tried to buy the resolution, and when its counterparty's chain step died, **told the truth instead of inventing a number**.

That last part wasn't a demo script. It's what the code does under counterparty failure, proven live. The disagreement itself reproduced across two independent real runs (VERIS scored node-ipc 34/100 both times) — the core thesis is not a lucky screenshot.

## What Quorum is

Dependabot, Snyk and Socket run static rules and emit **reports**. Nobody answers the only question a developer has at 2am when an advisory drops: **"should I keep shipping this in production, right now?"**

Quorum is an event-driven autonomous agent on CAP that:

1. **Watches** a registered repo's npm dependencies (OSV, GitHub, npm registry) for eight kinds of trust events — malicious releases, CVEs, maintainer changes, abandonment, license flips — deduped so each fires once.
2. **Decides whether the event is worth paying to investigate** (the Risk Gate). Patch releases and low-severity noise archive at **$0**. This is itself an autonomous economic decision, logged and shown.
3. **Hires two independent, other-team specialist agents** over CAP: Repo Doctor answers *"is this technically healthy?"*, VERIS answers *"is this trustworthy?"* The split is structural — disagreement between engineering health and supply-chain trust is expected and meaningful, not noise.
4. **Reconciles** the two lenses through a decision matrix into SHIP / REVIEW / DO_NOT_SHIP + confidence.
5. **Buys certainty only when justified**: below the policy's confidence target, with budget remaining, it purchases exactly one more independent opinion (Themis, fact-check), then recomputes. Budget caps are hard; honesty is harder — an unresolved escalation ships the real sub-target confidence, never a fake one.
6. Delivers `quorum.decision.v1` — decision, confidence, per-lens verdicts with order IDs and tx hashes, the disagreement in plain English, total spend, and every receipt.

Quorum is also **dual-role on one WebSocket**: a CAP *provider* (its `quorum.register` service is live on the Agent Store) and a CAP *requester* (it spends its own wallet hiring specialists per event).

## Why this is impossible on a normal API marketplace

The product is not the security check — Repo Doctor already sells one for $0.01. The product is **an agent that autonomously spends money to reduce its own uncertainty**:

- It hires independent counterparties it doesn't own, over a permissionless protocol, with escrow and on-chain settlement.
- Whether to spend at all, and how much, is governed by a risk policy (`startup` 0.70/$0.05 · `balanced` 0.80/$0.15 · `enterprise` 0.90/$0.25) — the buyer picks a policy once; the agent makes every per-event economic call.
- "$0 when nothing happens" is a real billing model here, not a free tier.

## Battle scars (all real, all documented in SDK_NOTES.md)

Building against live counterparties on real money surfaced things no offline test could:

- **A counterparty repriced 200×.** VERIS's $0.10 service quoted **$20.00** at accept time, twice in one day, then $0.10 again hours later. Quorum's response became a permanent feature: a **price guard** that checks the *actual* quoted cost after order creation and before payment, refuses over-cap quotes (order expires unpaid, $0 charged), and surfaces the refusal in the decision — autonomous economic self-defense, demo-visible where it happens.
- **A client-side race dropped real events.** Repo Doctor accepts negotiations in ~6 seconds — faster than the gap between `negotiateOrder()` resolving and the event waiter registering. Found on the first real call, fixed with an early-arrival buffer, regression-tested.
- **An unauthorized $0.11 spend from a stale env flag** became a structural guard: real spends now require an explicit `--confirm-real-spend` flag *on top of* `CROO_SIMULATE=false`. Process failures get engineering fixes, not promises to be careful.
- **Counterparty confabulation is a real risk**: VERIS's research sub-layer once described an npm IPC library as an "L1/L2 blockchain" with fabricated DeFi metrics. Policy: only VERIS's scored rubric feeds the verdict; narrative sub-reports are never parsed. Trust, but verify your verifiers.

## What's running right now

- **Worker** (event detector, risk gate, provider + requester loops, Slack notifier, read API) — deployed on Render, connected to CROO, listed live on the Agent Store.
- **Dashboard** — Next.js on Vercel, live event feed with per-hire order cards, tx links to Basescan, disagreement panels, confidence meters, spend tracking.
- **204 passing tests, `tsc` clean** — including polarity tests on the escalation math (a low "safe to ship" score must push toward DO_NOT_SHIP; inverting that comparison would quietly break everything, so it has its own test block).

## Rubric mapping

| Axis | Evidence |
|---|---|
| **Technical execution** | Dual-role CAP on one socket · full order state machine with event + polling fallback · price guard · requirements cache with restart-safe fallback · 204 tests |
| **A2A composability** | 3 independent other-team agents per investigated event (Repo Doctor, VERIS, Themis) · hired from genuine need, not self-trade |
| **Innovation** | Autonomous spend-to-resolve-uncertainty: Risk Gate ($0 archiving), disagreement-triggered escalation, budget caps, price-guard refusals |
| **Usability** | Real buyer (developers) · register once, decisions forever · $0 when nothing happens · live dashboard |
| **Presentation** | The 2-minute story: seeded event → agents disagree → autonomous tiebreak purchase → decision + receipts |

## Honest limitations

- Full pipeline runs on **npm only** (by design — depth over breadth; other ecosystems are discover-and-display).
- The escalation counterparty (Themis) has ~89% completion; its infra failure is why the honest-degradation path exists and has been exercised live. A backup fact-check agent for the slot is the natural next hire.
- VERIS's deliverable is free text, parsed against its own stated score bands — a provider prompt change could break parsing in ways a JSON schema can't catch. Disclosed, monitored, unfixable from our side.

*Every claim above traces to a numbered item in [SDK_NOTES.md](./SDK_NOTES.md) — the raw build log kept while it happened.*
