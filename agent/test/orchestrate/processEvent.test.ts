import type { AgentClient, EventStream } from "@croo-network/sdk";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OrderEventCorrelator } from "../../src/croo/orderCorrelator.js";
import type { QuorumDecision } from "../../src/decision/schema.js";
import type { TrustEvent } from "../../src/detector/types.js";
import { persistDecisionAndOrders, processEvent } from "../../src/orchestrate/processEvent.js";
import { openDb } from "../../src/store/db.js";
import { upsertRepo } from "../../src/store/repos.js";

function fakeStream() {
  return { on: () => undefined } as unknown as EventStream;
}
const fakeClient = {} as AgentClient;

const SIMULATED_HEALTHY_RAW = {
  overall_score: 82,
  readme_quality: { score: 78, comment: "" },
  test_coverage_signal: { score: 74, comment: "" },
  dependency_health: { score: 88, comment: "" },
  maintenance_activity: { score: 90, comment: "" },
  recommendations: [],
};
const SIMULATED_HIGH_RISK_REPORT = "VERIS TRUST REPORT\nLEGITIMACY:   22/100\nRECOMMENDATION: CRITICAL RISK";

describe("processEvent", () => {
  let db: Database.Database;
  let correlator: OrderEventCorrelator;

  beforeEach(() => {
    db = openDb(":memory:");
    correlator = new OrderEventCorrelator(fakeStream());
  });

  afterEach(() => db.close());

  it("archives a low-severity event at $0 without needing any GitHub repo resolution", async () => {
    const repo = upsertRepo(db, { githubUrl: "https://github.com/acme/monitored", riskPolicy: "balanced" });
    const event: TrustEvent = {
      dependency: "left-pad@1.3.1",
      type: "deprecation",
      severity_hint: "low",
      source: "npm",
      ref: "https://www.npmjs.com/package/left-pad",
      observed_at: new Date().toISOString(),
      context: { is_production_dependency: false, detail: "docs-only patch" },
    };

    const result = await processEvent({ db, client: fakeClient, correlator, repo, event, simulate: true });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.decision).toBe("ARCHIVED_NO_ACTION");
      expect(result.decision.total_spend_usdc).toBe(0);
      expect(result.decision.gate.investigated).toBe(false);
    }

    const row = db.prepare("SELECT COUNT(*) as n FROM decisions").get() as { n: number };
    expect(row.n).toBe(1);
  });

  it(
    "returns a degraded failure (never fabricates a decision) when the dependency has no resolvable GitHub repo",
    async () => {
      const repo = upsertRepo(db, { githubUrl: "https://github.com/acme/monitored2", riskPolicy: "enterprise" });
      const event: TrustEvent = {
        dependency: "evil-dep@2.4.1",
        type: "malicious_release",
        severity_hint: "critical",
        source: "osv",
        ref: "GHSA-test-degrade",
        observed_at: new Date().toISOString(),
        context: { is_production_dependency: true, detail: "compromised release" },
      };

      const result = await processEvent({ db, client: fakeClient, correlator, repo, event, simulate: true });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("no resolvable GitHub repository");

      const row = db.prepare("SELECT COUNT(*) as n FROM decisions").get() as { n: number };
      expect(row.n).toBe(0);
    },
    15000,
  );

  it(
    "runs the full investigated pipeline (simulate) and persists the decision plus outbound orders",
    async () => {
      const repo = upsertRepo(db, { githubUrl: "https://github.com/acme/monitored3", riskPolicy: "enterprise" });
      const event: TrustEvent = {
        dependency: "left-pad@1.3.1",
        type: "malicious_release",
        severity_hint: "critical",
        source: "osv",
        ref: "GHSA-test-investigate",
        observed_at: new Date().toISOString(),
        context: { is_production_dependency: true, detail: "compromised release" },
      };

      const result = await processEvent({
        db,
        client: fakeClient,
        correlator,
        repo,
        event,
        simulate: true,
        simulatedHealthRaw: SIMULATED_HEALTHY_RAW,
        simulatedTrustRaw: SIMULATED_HIGH_RISK_REPORT,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.decision.lenses.health?.verdict).toBe("healthy");
        expect(result.decision.lenses.trust?.verdict).toBe("high_risk");
      }

      const decisionRow = db.prepare("SELECT COUNT(*) as n FROM decisions").get() as { n: number };
      expect(decisionRow.n).toBe(1);
      const orderRow = db.prepare("SELECT COUNT(*) as n FROM orders WHERE direction = 'outbound'").get() as { n: number };
      expect(orderRow.n).toBeGreaterThanOrEqual(2);
    },
    15000,
  );

  it("does not notify Slack when the repo registered with notify_type = 'none'", async () => {
    const repo = upsertRepo(db, {
      githubUrl: "https://github.com/acme/quiet",
      riskPolicy: "balanced",
      notifyType: "none",
    });
    const event: TrustEvent = {
      dependency: "left-pad@1.3.1",
      type: "deprecation",
      severity_hint: "low",
      source: "npm",
      ref: "https://www.npmjs.com/package/left-pad",
      observed_at: new Date().toISOString(),
    };

    // No webhook stubbed at all — a notify attempt with a real URL would
    // throw inside fetch; success here just confirms notifySlack was never
    // even reached with a meaningful URL to call.
    const result = await processEvent({ db, client: fakeClient, correlator, repo, event, simulate: true });
    expect(result.ok).toBe(true);
  });
});

describe("persistDecisionAndOrders", () => {
  it("persists a synthetic (event-less) baseline decision without a seen_events link", () => {
    const db = openDb(":memory:");
    try {
      const decision: QuorumDecision = {
        schema: "quorum.decision.v1",
        dependency: "acme/thing@registration",
        event: {
          type: "baseline_scan",
          detail: "Registered.",
          source: "system",
          ref: "https://github.com/acme/thing",
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
        decided_at: new Date().toISOString(),
      };

      persistDecisionAndOrders(db, undefined, decision);

      const row = db.prepare("SELECT event_id, decision FROM decisions").get() as { event_id: number | null; decision: string };
      expect(row.event_id).toBeNull();
      expect(row.decision).toBe("ARCHIVED_NO_ACTION");
    } finally {
      db.close();
    }
  });
});
