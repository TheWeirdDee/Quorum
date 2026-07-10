# Fixtures & Test Matrix

Deterministic fixtures so the **Risk Gate → merge → confidence → escalation** logic and the demo dashboard can be built and tested with **zero live CAP calls or spend**. Wire a `USE_FIXTURES=true` mode that returns these instead of hiring real agents.

## Files
```
events/
  malicious_release.json     PRIMARY demo trigger (disagreement → escalation → DO_NOT_SHIP)
  low_severity_patch.json    CONTRAST — gate archives at $0 (show first in demo)
  new_cve.json               agreement path (no escalation)
agent-responses/
  repo-doctor.healthy.json   health lens = healthy   (for evil-dep)
  repo-doctor.unhealthy.json health lens = unhealthy (for abandoned-lib)
  veris.high_risk.json       trust lens = high_risk  (for evil-dep) ← disagrees
  veris.caution.json         trust lens = caution    (for abandoned-lib)
  escalation.confirms_risk.json  tie-breaker resolving toward high_risk
expected/
  decision.malicious_release.json        expected final decision (enterprise policy)
  decision.archived.json                 expected gate-archive output ($0)
  decision.agreement_no_escalation.json  expected agree-path output (balanced policy)
```

## Test matrix
| Scenario | Event | Policy | Health | Trust | Escalate? | Decision | Confidence | Spend |
|---|---|---|---|---|---|---|---|---|
| **A. Malicious (hero)** | malicious_release | enterprise (0.90) | healthy | high_risk | **yes** ($0.03) | DO_NOT_SHIP | 0.94 | $0.14 |
| **B. Archived** | low_severity_patch | any | — | — | no (never hired) | ARCHIVED_NO_ACTION | 1.0 | $0.00 |
| **C. Agreement** | new_cve | balanced (0.80) | unhealthy | caution | no (0.85 ≥ 0.80) | DO_NOT_SHIP | 0.85 | $0.11 |

These three cover the branches that matter: **spend-gate off** (B), **hire + agree, don't overspend** (C), **hire + disagree → buy certainty** (A).

## What each fixture exercises
- **Risk Gate** — A and C pass (investigate); B is archived before any spend. Assert B produces zero orders.
- **Normalization adapters** — `raw` → `normalized` for both Repo Doctor and VERIS. Build the adapter to read the `normalized` block; treat `raw` as the shape to reconcile against a **real** live deliverable later (field names are mocked — verify against an actual call).
- **Merge/confidence matrix** (SPEC §6) — assert the health×trust cell yields the expected decision+confidence.
- **Escalation engine** (SPEC §7) — A triggers (disagreement + below target + budget), C does not (agreement + at/above target). Assert the budget-cap guard: escalation must not exceed `budget_cap_usdc`.
- **Decision serializer** — output must validate against `schemas/quorum.decision.schema.json`.

## Demo harness
1. Inject `low_severity_patch` → show "Event classified LOW — archived, $0."
2. Inject `malicious_release` → watch gate pass, two CAP order cards appear (fixtures in dev, real tx on stage), disagreement panel lights up, confidence 0.60, enterprise policy buys escalation ($0.03), confidence → 0.94, DO_NOT_SHIP, Slack fires, three receipts shown, total $0.14.

⚠️ All `tx: 0xMOCK_...` values are fixtures — never present them as real settlements. On stage, real hashes come from live CAP orders; keep a recorded run as fallback if a hired agent is offline.
