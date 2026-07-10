import type { AgentClient, Event, EventStream, EventTypeName } from "@croo-network/sdk";
import { describe, expect, it } from "vitest";
import type { RiskPolicy } from "../../src/config/riskPolicy.js";
import { OrderEventCorrelator } from "../../src/croo/orderCorrelator.js";
import { escalate } from "../../src/escalate/escalate.js";
import type { MergeResult } from "../../src/merge/types.js";

function fakeStream() {
  const handlers = new Map<string, (event: Event) => void>();
  return {
    on: (eventType: EventTypeName | string, handler: (event: Event) => void) => {
      handlers.set(eventType, handler);
    },
  } as unknown as EventStream;
}

const fakeClient = {} as AgentClient;

const enterprisePolicy: RiskPolicy = {
  name: "enterprise",
  confidence_target: 0.9,
  budget_cap_usdc: 0.25,
  escalation_aggressiveness: "on_uncertainty",
};

const disagreementMerge: MergeResult = {
  decision: "REVIEW",
  confidence: 0.6,
  disagreement: "Repo Doctor rates it healthy; VERIS rates it high_risk.",
  needs_escalation: true,
  escalation_reason: "health/trust disagreement; confidence 0.60 < policy target 0.90",
};

const agreementMerge: MergeResult = {
  decision: "DO_NOT_SHIP",
  confidence: 0.85,
  disagreement: "",
  needs_escalation: false,
  escalation_reason: "",
};

function baseParams(overrides: Partial<Parameters<typeof escalate>[0]> = {}) {
  return {
    mergeResult: disagreementMerge,
    policy: enterprisePolicy,
    spentSoFar: 0.11,
    client: fakeClient,
    correlator: new OrderEventCorrelator(fakeStream()),
    packageName: "evil-dep",
    healthVerdict: "healthy" as const,
    trustVerdict: "high_risk" as const,
    trustConcern: "advisory reports a postinstall script exfiltrating environment variables",
    sources: ["GHSA-xxxx-demo-0001"],
    simulate: true,
    ...overrides,
  };
}

describe("escalate — trigger conditions", () => {
  it("does not trigger when needs_escalation is false (agreement case) — $0 spent on escalation", async () => {
    const outcome = await escalate(baseParams({ mergeResult: agreementMerge }));
    expect(outcome.triggered).toBe(false);
    expect(outcome.reason).toBe("");
    expect(outcome.cost_usdc).toBeUndefined();
  });

  it("blocks the hire when spentSoFar + assumed cost would exceed the budget cap — no hire attempted", async () => {
    const outcome = await escalate(baseParams({ policy: { ...enterprisePolicy, budget_cap_usdc: 0.1 }, spentSoFar: 0.09 }));
    expect(outcome.triggered).toBe(false);
    expect(outcome.reason).toContain("budget remaining $0.01");
    expect(outcome.reason).toContain("est. escalation cost $0.03");
    expect(outcome.cost_usdc).toBeUndefined();
    expect(outcome.tx).toBeUndefined();
  });

  it("allows the hire when spentSoFar + assumed cost exactly equals the budget cap", async () => {
    const outcome = await escalate(
      baseParams({
        policy: { ...enterprisePolicy, budget_cap_usdc: 0.14 },
        spentSoFar: 0.11,
        simulatedRaw: "Confidence: 0.05\nConfirmed malicious.",
      }),
    );
    expect(outcome.triggered).toBe(true);
    expect(outcome.resolvedDecision).toBe("DO_NOT_SHIP");
  });
});

describe("escalate — graceful degradation, never fabricates a resolution", () => {
  it("returns triggered=true but no resolution when ESCALATION_AGENT_SERVICE_ID is empty and not simulating", async () => {
    const outcome = await escalate(baseParams({ simulate: false, serviceId: "" }));
    expect(outcome.triggered).toBe(true);
    expect(outcome.reason).toContain("not configured");
    expect(outcome.resolvedDecision).toBeUndefined();
    expect(outcome.resolvedConfidence).toBeUndefined();
    expect(outcome.tx).toBeUndefined();
  });

  it("returns triggered=true but no resolution when the simulated hire fails (missing fixture)", async () => {
    const outcome = await escalate(baseParams({ simulate: true /* simulatedRaw omitted */ }));
    expect(outcome.triggered).toBe(true);
    expect(outcome.reason).toContain("failed at simulate_missing_fixture");
    expect(outcome.resolvedDecision).toBeUndefined();
    expect(outcome.resolvedConfidence).toBeUndefined();
  });

  it("returns triggered=true but no resolution when Themis's score is too close to 0.5 to be decisive", async () => {
    const outcome = await escalate(baseParams({ simulatedRaw: "Confidence: 0.52\nInconclusive." }));
    expect(outcome.triggered).toBe(true);
    expect(outcome.reason).toContain("too close to call");
    expect(outcome.resolvedDecision).toBeUndefined();
    expect(outcome.resolvedConfidence).toBeUndefined();
    // still a real (simulated) hire — cost/tx ARE present, just no resolution
    expect(outcome.tx).toBe("SIMULATED");
    expect(outcome.review).toContain("Inconclusive");
  });
});

describe("escalate — polarity (the trap): LOW safety score -> DO_NOT_SHIP, HIGH safety score -> SHIP", () => {
  it("a LOW Themis score (could not verify safety) resolves toward DO_NOT_SHIP, never SHIP", async () => {
    const outcome = await escalate(baseParams({ simulatedRaw: "Confidence: 0.05\nConfirmed malicious postinstall." }));
    expect(outcome.triggered).toBe(true);
    expect(outcome.resolvedDecision).toBe("DO_NOT_SHIP");
    expect(outcome.resolvedDecision).not.toBe("SHIP");
  });

  it("a HIGH Themis score (verified safe) resolves toward SHIP, never DO_NOT_SHIP", async () => {
    const outcome = await escalate(baseParams({ simulatedRaw: "Confidence: 0.95\nNo credible risk found; claims well-supported." }));
    expect(outcome.triggered).toBe(true);
    expect(outcome.resolvedDecision).toBe("SHIP");
    expect(outcome.resolvedDecision).not.toBe("DO_NOT_SHIP");
  });

  it("a moderately low score (0.3) still resolves toward DO_NOT_SHIP, not SHIP", async () => {
    const outcome = await escalate(baseParams({ simulatedRaw: "Confidence: 0.3\nLikely unsafe but not fully confirmed." }));
    expect(outcome.resolvedDecision).toBe("DO_NOT_SHIP");
  });

  it("a moderately high score (0.7) still resolves toward SHIP, not DO_NOT_SHIP", async () => {
    const outcome = await escalate(baseParams({ simulatedRaw: "Confidence: 0.7\nProbably safe, some minor gaps in evidence." }));
    expect(outcome.resolvedDecision).toBe("SHIP");
  });
});

describe("escalate — the demo case: malicious event lands DO_NOT_SHIP at high confidence", () => {
  it("Themis score 0.08 blended with pre-confidence 0.60 climbs to ~0.9x, matching the demo narrative", async () => {
    const outcome = await escalate(baseParams({ simulatedRaw: "Confidence: 0.08\nConfirmed malicious." }));
    expect(outcome.resolvedDecision).toBe("DO_NOT_SHIP");
    // decisiveness = |0.08 - 0.5| * 2 = 0.84; confidence = 0.60 + (1-0.60)*0.84 = 0.936
    expect(outcome.resolvedConfidence).toBeCloseTo(0.936, 3);
    expect(outcome.resolvedConfidence).toBeGreaterThan(0.9);
  });
});

describe("escalate — blend formula properties", () => {
  it("a neutral score (exactly 0.5) leaves confidence exactly at the pre-escalation value (decisiveness=0)", async () => {
    const outcome = await escalate(baseParams({ simulatedRaw: "Confidence: 0.5\nCompletely uncertain." }));
    // decisiveness = 0, below ESCALATION_MIN_DECISIVENESS -> inconclusive, no resolution at all
    expect(outcome.resolvedDecision).toBeUndefined();
    expect(outcome.resolvedConfidence).toBeUndefined();
  });

  it("a maximally decisive score (0 or 1) pushes confidence close to (but not fabricating beyond) 1.0", async () => {
    const outcome = await escalate(baseParams({ simulatedRaw: "Confidence: 0.0\nDefinitively confirmed malicious." }));
    // decisiveness = 1.0; confidence = 0.60 + (1-0.60)*1.0 = 1.0
    expect(outcome.resolvedConfidence).toBeCloseTo(1.0, 5);
  });

  it("logs the economic reasoning with pre-confidence, target, budget remaining, and post-confidence (SPEC §7)", async () => {
    const outcome = await escalate(baseParams({ simulatedRaw: "Confidence: 0.08\nConfirmed malicious." }));
    expect(outcome.reason).toContain("0.60"); // pre-confidence
    expect(outcome.reason).toContain("0.90"); // target
    expect(outcome.reason).toMatch(/budget remaining \$0\.14/);
    expect(outcome.reason).toContain("0.94"); // post-confidence (rounded)
  });
});
