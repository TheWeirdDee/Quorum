import { describe, expect, it } from "vitest";
import { RISK_POLICIES, type RiskPolicy } from "../../src/config/riskPolicy.js";
import { merge } from "../../src/merge/merge.js";
import type { HealthVerdict, TrustVerdict } from "../../src/merge/types.js";

describe("merge — health×trust matrix (SPEC §6)", () => {
  const cases: Array<[HealthVerdict, TrustVerdict, string, number]> = [
    ["healthy", "trusted", "SHIP", 0.95],
    ["healthy", "caution", "REVIEW", 0.75],
    ["healthy", "high_risk", "REVIEW", 0.6],
    ["mixed", "trusted", "REVIEW", 0.75],
    ["mixed", "caution", "REVIEW", 0.65],
    ["mixed", "high_risk", "DO_NOT_SHIP", 0.85],
    ["unhealthy", "trusted", "REVIEW", 0.7],
    ["unhealthy", "caution", "DO_NOT_SHIP", 0.85],
    ["unhealthy", "high_risk", "DO_NOT_SHIP", 0.97],
  ];

  it.each(cases)("%s × %s -> %s @ %s", (health, trust, decision, confidence) => {
    const result = merge(health, trust, RISK_POLICIES.balanced);
    expect(result.decision).toBe(decision);
    expect(result.confidence).toBe(confidence);
  });

  it("flags disagreement=true (non-empty text) only for the healthy+high_risk cell", () => {
    for (const [health, trust] of cases.map(([h, t]) => [h, t] as [HealthVerdict, TrustVerdict])) {
      const result = merge(health, trust, RISK_POLICIES.balanced);
      const expectDisagreement = health === "healthy" && trust === "high_risk";
      expect(result.disagreement !== "").toBe(expectDisagreement);
    }
  });
});

describe("merge — needs_escalation (FR-14: sub-target confidence escalates, SDK_NOTES item 25)", () => {
  it("is true for the disagreement cell when confidence is below the policy target (enterprise, 0.60 < 0.90)", () => {
    const result = merge("healthy", "high_risk", RISK_POLICIES.enterprise);
    expect(result.needs_escalation).toBe(true);
    expect(result.escalation_reason).toContain("disagreement");
    expect(result.escalation_reason).toContain("0.60");
    expect(result.escalation_reason).toContain("0.90");
  });

  it("is true for the disagreement cell under startup too (0.60 < 0.70)", () => {
    const result = merge("healthy", "high_risk", RISK_POLICIES.startup);
    expect(result.needs_escalation).toBe(true);
  });

  it("is false for the disagreement cell when the policy target is at or below the cell confidence", () => {
    const lenientPolicy: RiskPolicy = {
      name: "startup",
      confidence_target: 0.5,
      budget_cap_usdc: 0.05,
      escalation_aggressiveness: "rarely",
    };
    const result = merge("healthy", "high_risk", lenientPolicy);
    expect(result.needs_escalation).toBe(false);
    expect(result.escalation_reason).toBe("");
  });

  it("is false when agreement is at/above target (unhealthy+caution, 0.85 >= 0.80 balanced) — don't overspend", () => {
    const result = merge("unhealthy", "caution", RISK_POLICIES.balanced);
    expect(result.confidence).toBe(0.85);
    expect(result.needs_escalation).toBe(false);
  });

  it("is TRUE for a non-disagreement, sub-target cell (healthy+caution, 0.75 < 0.90 enterprise) — the node-ipc run's exact case", () => {
    const result = merge("healthy", "caution", RISK_POLICIES.enterprise);
    expect(result.confidence).toBe(0.75);
    expect(result.needs_escalation).toBe(true);
    expect(result.escalation_reason).not.toContain("disagreement"); // sub-target, but not the disagreement cell
    expect(result.escalation_reason).toContain("0.75");
  });

  it("is TRUE for mixed+caution under enterprise (0.65 < 0.90) — FR-14, no longer restricted to the labeled cell", () => {
    const result = merge("mixed", "caution", RISK_POLICIES.enterprise);
    expect(result.needs_escalation).toBe(true);
  });

  it("is false for mixed+caution under a policy whose target it meets (0.65 >= 0.5)", () => {
    const lenientPolicy: RiskPolicy = {
      name: "startup",
      confidence_target: 0.5,
      budget_cap_usdc: 0.05,
      escalation_aggressiveness: "rarely",
    };
    const result = merge("mixed", "caution", lenientPolicy);
    expect(result.needs_escalation).toBe(false);
  });
});

describe("merge — disagreement narrative", () => {
  it("weaves in provided signals for both lenses", () => {
    const result = merge("healthy", "high_risk", RISK_POLICIES.enterprise, {
      healthSignals: ["active commits (3d)", "tests present"],
      trustSignals: ["ownership changed 6d ago"],
    });
    expect(result.disagreement).toContain("Repo Doctor");
    expect(result.disagreement).toContain("active commits (3d)");
    expect(result.disagreement).toContain("VERIS");
    expect(result.disagreement).toContain("ownership changed 6d ago");
  });

  it("falls back to a plain verdict sentence when no signals are provided", () => {
    const result = merge("healthy", "high_risk", RISK_POLICIES.enterprise);
    expect(result.disagreement).toBe("Repo Doctor rates it healthy; VERIS rates it high_risk.");
  });
});
