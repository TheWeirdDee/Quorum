import type { DecisionListItem, RepoListItem } from "./types";

/**
 * Seeded data for /dashboard?demo=true — the recorded-demo surface (SPEC §8).
 * Every card is honest about what it is: the node-ipc decision is the REAL
 * 2026-07-03 mainnet run with its REAL settlement txs (SDK_NOTES.md item 26);
 * everything else carries SIMULATED order/tx markers, which TxLink renders
 * as plain unlinked text so a fixture can never impersonate a receipt.
 */

/** Real, existing repos — the panel links straight to GitHub, so fictional slugs would 404. */
export const DEMO_REPOS: RepoListItem[] = [
  {
    id: 1,
    github_url: "https://github.com/expressjs/express",
    risk_policy: "enterprise",
    budget_cap_usdc: 0.25,
    notify_type: "slack",
    created_at: "2026-07-10T09:12:00Z",
    dependencyCount: 31,
  },
  {
    id: 2,
    github_url: "https://github.com/lodash/lodash",
    risk_policy: "startup",
    budget_cap_usdc: null,
    notify_type: "none",
    created_at: "2026-07-10T09:14:00Z",
    dependencyCount: 12,
  },
];

const baselineScan: DecisionListItem = {
  id: 1,
  decision: "ARCHIVED_NO_ACTION",
  confidence: 1,
  total_spend_usdc: 0,
  decided_at: "2026-07-10T09:12:31Z",
  payload: {
    schema: "quorum.decision.v1",
    dependency: "expressjs/express@registration",
    event: {
      type: "baseline_scan",
      detail: "Registered https://github.com/expressjs/express; indexed 31 npm dependencies. No investigatable trust events found.",
      source: "system",
      ref: "https://github.com/expressjs/express",
      severity_hint: "info",
    },
    gate: { investigated: false, reason: "no investigatable trust events at registration" },
    decision: "ARCHIVED_NO_ACTION",
    confidence: 1,
    lenses: {},
    escalation: { triggered: false },
    disagreement: "",
    total_spend_usdc: 0,
    receipts: [],
    decided_at: "2026-07-10T09:12:31Z",
  },
};

const archivedPatch: DecisionListItem = {
  id: 2,
  decision: "ARCHIVED_NO_ACTION",
  confidence: 1,
  total_spend_usdc: 0,
  decided_at: "2026-07-11T10:11:20Z",
  payload: {
    schema: "quorum.decision.v1",
    dependency: "left-pad@1.3.1",
    event: {
      type: "deprecation",
      detail: "Patch release, changelog is docs-only. Non-production (devDependency). No advisory.",
      source: "npm",
      ref: "https://www.npmjs.com/package/left-pad",
      severity_hint: "low",
    },
    gate: { investigated: false, reason: "low severity, non-production, no advisory — not worth purchasing analysis" },
    decision: "ARCHIVED_NO_ACTION",
    confidence: 1,
    lenses: {},
    escalation: { triggered: false },
    disagreement: "",
    total_spend_usdc: 0,
    receipts: [],
    decided_at: "2026-07-11T10:11:20Z",
  },
};

/** The REAL mainnet investigation — real verdicts, real costs, real tx hashes (Basescan-linkable). */
const realNodeIpc: DecisionListItem = {
  id: 3,
  decision: "REVIEW",
  confidence: 0.6,
  total_spend_usdc: 0.11,
  decided_at: "2026-07-03T17:10:12Z",
  payload: {
    schema: "quorum.decision.v1",
    dependency: "node-ipc@9.2.1",
    event: {
      type: "new_cve",
      detail: "REAL RUN (Base mainnet): CVE-2022-23812 — embedded protestware; prior versions wrote to disk based on geolocation.",
      source: "osv",
      ref: "CVE-2022-23812",
      severity_hint: "critical",
    },
    gate: { investigated: true, reason: "critical-severity CVE on a production dependency" },
    decision: "REVIEW",
    confidence: 0.6,
    lenses: {
      health: {
        agent: "Repo Doctor",
        verdict: "healthy",
        order_id: "192df832-b697-4942-ad0c-ed34dedb5244",
        tx: "0xd0e04941148408e40d9c5df11807730e94aeeb35b6d8ae4ff8f9de3c0987f41f",
        cost_usdc: 0.01,
      },
      trust: {
        agent: "VERIS",
        verdict: "high_risk",
        tx: "0x600e5f58b835aa753b97eb4a5a781c13506044a309ef0429961918a22a943c55",
        cost_usdc: 0.1,
      },
    },
    escalation: {
      triggered: true,
      reason:
        "confidence 0.60 < target 0.90; escalation attempted but the counterparty's on-chain order creation never confirmed — alerting with honest pre-escalation confidence, $0 paid for the failure",
    },
    disagreement: "Repo Doctor rates it healthy; VERIS rates it high_risk (legitimacy 34/100).",
    total_spend_usdc: 0.11,
    receipts: [
      "0xd0e04941148408e40d9c5df11807730e94aeeb35b6d8ae4ff8f9de3c0987f41f",
      "0x600e5f58b835aa753b97eb4a5a781c13506044a309ef0429961918a22a943c55",
    ],
    decided_at: "2026-07-03T17:10:12Z",
  },
};

/** The scripted climax (SPEC §8): seeded malicious release, disagreement, escalation resolves to DO_NOT_SHIP. */
const maliciousRelease: DecisionListItem = {
  id: 4,
  decision: "DO_NOT_SHIP",
  confidence: 0.94,
  total_spend_usdc: 0.14,
  decided_at: "2026-07-11T10:15:44Z",
  payload: {
    schema: "quorum.decision.v1",
    dependency: "evil-dep@2.4.1",
    event: {
      type: "malicious_release",
      detail: "Version 2.4.1 published 40 minutes ago; advisory reports a postinstall script exfiltrating environment variables. Prior versions clean.",
      source: "osv",
      ref: "GHSA-xxxx-demo-0001",
      severity_hint: "critical",
    },
    gate: { investigated: true, reason: "critical severity on a production dependency" },
    decision: "DO_NOT_SHIP",
    confidence: 0.94,
    lenses: {
      health: { agent: "Repo Doctor", verdict: "healthy", order_id: "SIMULATED-demo1", tx: "SIMULATED", cost_usdc: 0.01 },
      trust: { agent: "VERIS", verdict: "high_risk", order_id: "SIMULATED-demo2", tx: "SIMULATED", cost_usdc: 0.1 },
    },
    escalation: {
      triggered: true,
      agent: "Themis",
      order_id: "SIMULATED-demo3",
      tx: "SIMULATED",
      cost_usdc: 0.03,
      reason: "confidence 0.60 < target 0.90; budget remaining $0.14; purchased one Themis opinion (safety score 0.07) — resolved toward DO_NOT_SHIP, confidence now 0.94",
    },
    disagreement:
      "Repo Doctor sees an active, well-tested repo; VERIS flags a publisher-ownership change and a collapsed trust score. Escalation (Themis): could not verify this release is safe to ship.",
    total_spend_usdc: 0.14,
    receipts: ["SIMULATED", "SIMULATED", "SIMULATED"],
    decided_at: "2026-07-11T10:15:44Z",
  },
};

/** Shown immediately on load (oldest at the bottom, matching the live feed's DESC order). */
export const DEMO_INITIAL_DECISIONS: DecisionListItem[] = [archivedPatch, baselineScan];

/** Prepended to the feed on a timer, in narrative order — the $0 story is already on screen, then the real run lands, then the climax. Paced for narration: reload the page to replay from the top. */
export const DEMO_REVEALS: { afterMs: number; decision: DecisionListItem }[] = [
  { afterMs: 12_000, decision: realNodeIpc },
  { afterMs: 28_000, decision: maliciousRelease },
];
