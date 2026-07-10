import type { AgentClient, Event, EventStream, EventTypeName } from "@croo-network/sdk";
import { describe, expect, it } from "vitest";
import { RISK_POLICIES } from "../../src/config/riskPolicy.js";
import { OrderEventCorrelator } from "../../src/croo/orderCorrelator.js";
import { loadFixtureEvents } from "../../src/detector/index.js";
import type { TrustEvent } from "../../src/detector/types.js";
import { investigate } from "../../src/orchestrate/investigate.js";

function fakeStream() {
  const handlers = new Map<string, (event: Event) => void>();
  return {
    on: (eventType: EventTypeName | string, handler: (event: Event) => void) => {
      handlers.set(eventType, handler);
    },
  } as unknown as EventStream;
}

const fakeClient = {} as AgentClient;

const events = loadFixtureEvents();
const patchEvent = events.find((e) => e.type === "deprecation") as TrustEvent;
const cveEvent = events.find((e) => e.type === "new_cve") as TrustEvent;
const maliciousEvent = events.find((e) => e.type === "malicious_release") as TrustEvent;

// Confirmed real shapes (SDK_NOTES.md items 12, 19) — same as the ones proven in test/hire/*.
const healthyRaw = {
  overall_score: 82,
  readme_quality: { score: 78, comment: "Clear docs." },
  test_coverage_signal: { score: 74, comment: "Tests present." },
  dependency_health: { score: 88, comment: "1 outdated dependency." },
  maintenance_activity: { score: 90, comment: "Active commits." },
  recommendations: ["Add coverage reporting."],
};
const unhealthyRaw = {
  overall_score: 21,
  readme_quality: { score: 10, comment: "No README." },
  test_coverage_signal: { score: 5, comment: "No tests." },
  dependency_health: { score: 30, comment: "14 outdated dependencies." },
  maintenance_activity: { score: 8, comment: "No commits in 500+ days." },
  recommendations: ["Add a README.", "Add tests.", "Update dependencies."],
};
const highRiskReport = "VERIS TRUST REPORT\nLEGITIMACY:   22/100\nRECOMMENDATION: CRITICAL RISK";
const cautionReport = "VERIS TRUST REPORT\nLEGITIMACY:   50/100\nRECOMMENDATION: MIXED SIGNALS";
// score 0.075 blended with pre-confidence 0.60 lands exactly at 0.94: decisiveness=|0.075-0.5|*2=0.85; 0.60+(1-0.60)*0.85=0.94
const themisConfirmsRiskRaw = "THEMIS FACT-CHECK\n\nConfidence: 0.075\n\nPostinstall confirmed to exfiltrate environment variables to an external host.";

// Trimmed verbatim from the REAL paid node-ipc VERIS deliverable (order
// bad24e61-..., 2026-07-03): legitimacy 34/100, VERIS's own label "HIGH RISK".
const realNodeIpcVerisReport = [
  "VERIS TRUST REPORT",
  "Subject:          node-ipc",
  "LEGITIMACY:   34/100  ███████░░░░░░░░░░░░░",
  "RECOMMENDATION:  ✗ HIGH RISK  [Band: 30-49]",
].join("\n");

describe("investigate — archived path (gate rejects before any hire)", () => {
  it("archives the low-severity patch event without hiring either lens, $0", async () => {
    const correlator = new OrderEventCorrelator(fakeStream());
    const result = await investigate({
      event: patchEvent,
      policy: RISK_POLICIES.balanced,
      client: fakeClient,
      correlator,
      repoUrl: "https://github.com/stringops/left-pad",
      packageName: "left-pad",
      simulate: true,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.decision).toBe("ARCHIVED_NO_ACTION");
      expect(result.decision.total_spend_usdc).toBe(0);
      expect(result.decision.lenses).toEqual({});
    }
  });
});

describe("investigate — malicious_release, enterprise policy: disagreement -> escalation -> final decision", () => {
  it("resolves the disagreement via escalation: REVIEW@0.60 -> DO_NOT_SHIP@0.94, third receipt included (M4)", async () => {
    const correlator = new OrderEventCorrelator(fakeStream());
    const result = await investigate({
      event: maliciousEvent,
      policy: RISK_POLICIES.enterprise,
      client: fakeClient,
      correlator,
      repoUrl: "https://github.com/acme/evil-dep",
      packageName: "evil-dep",
      simulate: true,
      simulatedHealthRaw: healthyRaw,
      simulatedTrustRaw: highRiskReport,
      simulatedEscalationRaw: themisConfirmsRiskRaw,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // pre-escalation state is still visible via mergeResult — nothing here overwrites it
      expect(result.mergeResult?.decision).toBe("REVIEW");
      expect(result.mergeResult?.confidence).toBe(0.6);
      expect(result.mergeResult?.needs_escalation).toBe(true);

      // final, post-escalation decision
      expect(result.decision.decision).toBe("DO_NOT_SHIP");
      expect(result.decision.confidence).toBeCloseTo(0.94, 5);
      expect(result.decision.escalation.triggered).toBe(true);
      expect(result.decision.escalation.agent).toBe("Themis");
      expect(result.decision.escalation.reason).toContain("resolved toward DO_NOT_SHIP");
      expect(result.decision.receipts).toEqual(["SIMULATED", "SIMULATED", "SIMULATED"]);
      expect(result.decision.total_spend_usdc).toBe(0); // simulate mode -> $0, always
      expect(result.decision.disagreement).toContain("exfiltrate environment variables"); // Themis's review, appended
    }
  });

  it("degrades gracefully when the escalation agent slot is empty/unavailable: confidence stays UNCHANGED, no fabrication", async () => {
    const correlator = new OrderEventCorrelator(fakeStream());
    const result = await investigate({
      event: maliciousEvent,
      policy: RISK_POLICIES.enterprise,
      client: fakeClient,
      correlator,
      repoUrl: "https://github.com/acme/evil-dep",
      packageName: "evil-dep",
      simulate: true,
      simulatedHealthRaw: healthyRaw,
      simulatedTrustRaw: highRiskReport,
      // simulatedEscalationRaw omitted -> escalation hire fails at simulate_missing_fixture
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // honest, pre-escalation state — NOT the 0.94 final, because escalation didn't resolve anything
      expect(result.decision.decision).toBe("REVIEW");
      expect(result.decision.confidence).toBe(0.6);
      expect(result.decision.confidence).not.toBe(0.94);
      expect(result.decision.escalation.triggered).toBe(true);
      expect(result.decision.escalation.reason).toContain("failed");
      expect(result.decision.receipts).toEqual(["SIMULATED", "SIMULATED"]); // no third receipt — nothing was bought
    }
  });
});

describe("investigate — REPLAY of the real node-ipc run under both item-25 corrections (simulate, $0)", () => {
  it("the real verdicts now produce healthy×high_risk -> disagreement@0.60 -> escalation fires -> DO_NOT_SHIP@0.94", async () => {
    const correlator = new OrderEventCorrelator(fakeStream());
    const result = await investigate({
      event: {
        dependency: "node-ipc@investigate",
        type: "new_cve",
        severity_hint: "high",
        source: "github",
        ref: "CVE-2022-23812",
        observed_at: new Date().toISOString(),
        context: {
          repo: "https://github.com/RIAEvangelist/node-ipc",
          is_production_dependency: true,
          detail: "Maintainer intentionally added destructive code targeting Russian/Belarusian IPs, tracked as CVE-2022-23812.",
        },
      },
      policy: RISK_POLICIES.enterprise,
      client: fakeClient,
      correlator,
      repoUrl: "https://github.com/RIAEvangelist/node-ipc",
      packageName: "node-ipc",
      simulate: true,
      simulatedHealthRaw: healthyRaw, // Repo Doctor returned healthy on the real run
      simulatedTrustRaw: realNodeIpcVerisReport, // the REAL report: 34/100, "HIGH RISK"
      simulatedEscalationRaw: themisConfirmsRiskRaw,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Remap (item 25a): 34/100 is now high_risk, not caution.
      expect(result.decision.lenses.trust?.verdict).toBe("high_risk");
      // The disagreement cell, pre-escalation.
      expect(result.mergeResult?.decision).toBe("REVIEW");
      expect(result.mergeResult?.confidence).toBe(0.6);
      expect(result.mergeResult?.needs_escalation).toBe(true);
      // Escalation fires and resolves.
      expect(result.decision.escalation.triggered).toBe(true);
      expect(result.decision.escalation.agent).toBe("Themis");
      expect(result.decision.decision).toBe("DO_NOT_SHIP");
      expect(result.decision.confidence).toBeCloseTo(0.94, 5);
      expect(result.decision.receipts).toHaveLength(3);
    }
  });

  it("FR-14 (item 25b) standalone: healthy×caution@0.75 under enterprise now escalates too (the pre-remap outcome would also have bought certainty)", async () => {
    const correlator = new OrderEventCorrelator(fakeStream());
    const result = await investigate({
      event: maliciousEvent,
      policy: RISK_POLICIES.enterprise,
      client: fakeClient,
      correlator,
      repoUrl: "https://github.com/acme/evil-dep",
      packageName: "evil-dep",
      simulate: true,
      simulatedHealthRaw: healthyRaw,
      simulatedTrustRaw: "VERIS TRUST REPORT\nLEGITIMACY:   55/100\nRECOMMENDATION: MIXED SIGNALS", // caution under the new bands
      simulatedEscalationRaw: themisConfirmsRiskRaw,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.lenses.trust?.verdict).toBe("caution");
      expect(result.mergeResult?.confidence).toBe(0.75);
      expect(result.mergeResult?.needs_escalation).toBe(true); // 0.75 < 0.90 — FR-14
      expect(result.decision.escalation.triggered).toBe(true);
      expect(result.decision.decision).toBe("DO_NOT_SHIP"); // Themis's low safety score resolves it
    }
  });
});

describe("investigate — new_cve, balanced policy: agreement -> DO_NOT_SHIP, no escalation needed", () => {
  it("hires both lenses (simulated) and merges to agreement, matching fixtures/expected's agreement scenario", async () => {
    const correlator = new OrderEventCorrelator(fakeStream());
    const result = await investigate({
      event: cveEvent,
      policy: RISK_POLICIES.balanced,
      client: fakeClient,
      correlator,
      repoUrl: "https://github.com/ghost/abandoned-lib",
      packageName: "abandoned-lib",
      simulate: true,
      simulatedHealthRaw: unhealthyRaw,
      simulatedTrustRaw: cautionReport,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.decision).toBe("DO_NOT_SHIP");
      expect(result.decision.confidence).toBe(0.85);
      expect(result.decision.lenses.health?.verdict).toBe("unhealthy");
      expect(result.decision.lenses.trust?.verdict).toBe("caution");
      expect(result.decision.escalation).toEqual({ triggered: false });
      expect(result.decision.escalation.cost_usdc).toBeUndefined();
      expect(result.decision.receipts).toEqual(["SIMULATED", "SIMULATED"]); // no third receipt — escalation never attempted
      expect(result.decision.disagreement).toBe("");
      expect(result.mergeResult?.needs_escalation).toBe(false);
    }
  });
});

describe("investigate — degrades gracefully on a lens failure, never fabricates a decision (FR-13)", () => {
  it("returns ok:false when the health hire fails, carrying the trust lens that DID succeed", async () => {
    const correlator = new OrderEventCorrelator(fakeStream());
    const result = await investigate({
      event: maliciousEvent,
      policy: RISK_POLICIES.enterprise,
      client: fakeClient,
      correlator,
      repoUrl: "https://github.com/acme/evil-dep",
      packageName: "evil-dep",
      simulate: true,
      // simulatedHealthRaw omitted -> hireRepoDoctor fails at simulate_missing_fixture
      simulatedTrustRaw: highRiskReport,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedLenses).toEqual(["health"]);
      expect(result.partialLenses.trust?.verdict).toBe("high_risk");
      expect(result.partialLenses.health).toBeUndefined();
      expect(result.reason).toContain("health");
      expect(result.reason).toContain("Repo Doctor");
    }
  });

  it("returns ok:false with both lenses failed when neither simulate fixture is supplied", async () => {
    const correlator = new OrderEventCorrelator(fakeStream());
    const result = await investigate({
      event: maliciousEvent,
      policy: RISK_POLICIES.enterprise,
      client: fakeClient,
      correlator,
      repoUrl: "https://github.com/acme/evil-dep",
      packageName: "evil-dep",
      simulate: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedLenses).toEqual(["health", "trust"]);
      expect(result.partialLenses.health).toBeUndefined();
      expect(result.partialLenses.trust).toBeUndefined();
    }
  });
});
