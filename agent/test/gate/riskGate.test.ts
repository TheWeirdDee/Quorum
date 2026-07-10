import { describe, expect, it } from "vitest";
import { RISK_POLICIES } from "../../src/config/riskPolicy.js";
import { riskGate } from "../../src/gate/riskGate.js";
import { loadFixtureEvents } from "../../src/detector/index.js";
import type { TrustEvent } from "../../src/detector/types.js";

const fixtureEvents = loadFixtureEvents();
const malicious = fixtureEvents.find((e) => e.type === "malicious_release");
const patch = fixtureEvents.find((e) => e.type === "deprecation");
const cve = fixtureEvents.find((e) => e.type === "new_cve");

describe("riskGate — fixture boundary", () => {
  it("archives the low-severity, non-production, no-advisory deprecation (left-pad)", () => {
    const result = riskGate(patch as TrustEvent, RISK_POLICIES.balanced);
    expect(result.investigated).toBe(false);
    expect(result.reason).toBe("low severity, non-production, no advisory — not worth purchasing analysis");
  });

  it("investigates the critical malicious_release on a production dependency (evil-dep)", () => {
    const result = riskGate(malicious as TrustEvent, RISK_POLICIES.enterprise);
    expect(result.investigated).toBe(true);
    expect(result.reason).toBe("critical severity on a production dependency");
  });

  it("investigates the high-severity new_cve on a production dependency (abandoned-lib)", () => {
    const result = riskGate(cve as TrustEvent, RISK_POLICIES.balanced);
    expect(result.investigated).toBe(true);
    expect(result.reason).toBe("high-severity CVE on a production dependency");
  });
});

describe("riskGate — rule coverage", () => {
  const base: TrustEvent = {
    dependency: "some-pkg@1.0.0",
    type: "new_cve",
    severity_hint: "medium",
    source: "osv",
    ref: "GHSA-test-0001",
    observed_at: "2026-01-01T00:00:00Z",
  };

  it("archives an info-severity event regardless of type", () => {
    const result = riskGate({ ...base, severity_hint: "info" }, RISK_POLICIES.balanced);
    expect(result.investigated).toBe(false);
  });

  it("investigates maintainer_change only when the dependency is production", () => {
    const event: TrustEvent = { ...base, type: "maintainer_change", context: { is_production_dependency: true } };
    expect(riskGate(event, RISK_POLICIES.balanced).investigated).toBe(true);

    const devEvent: TrustEvent = { ...base, type: "maintainer_change", context: { is_production_dependency: false } };
    const devResult = riskGate(devEvent, RISK_POLICIES.balanced);
    expect(devResult.investigated).toBe(false);
  });

  it("always investigates repo_archived", () => {
    const event: TrustEvent = { ...base, type: "repo_archived", severity_hint: "medium" };
    expect(riskGate(event, RISK_POLICIES.startup).investigated).toBe(true);
  });

  it("investigates license_change only when context.restrictive is true", () => {
    const restrictive: TrustEvent = { ...base, type: "license_change", context: { restrictive: true } };
    expect(riskGate(restrictive, RISK_POLICIES.balanced).investigated).toBe(true);

    const permissive: TrustEvent = { ...base, type: "license_change", context: { restrictive: false } };
    expect(riskGate(permissive, RISK_POLICIES.balanced).investigated).toBe(false);
  });

  it("defers an ambiguous medium-severity new_cve to policy: enterprise investigates, startup archives", () => {
    const ambiguous: TrustEvent = { ...base, type: "new_cve", severity_hint: "medium" };

    const enterpriseResult = riskGate(ambiguous, RISK_POLICIES.enterprise);
    expect(enterpriseResult.investigated).toBe(true);
    expect(enterpriseResult.reason).toContain("ambiguous");

    const startupResult = riskGate(ambiguous, RISK_POLICIES.startup);
    expect(startupResult.investigated).toBe(false);

    const balancedResult = riskGate(ambiguous, RISK_POLICIES.balanced);
    expect(balancedResult.investigated).toBe(false);
  });

  it("archives any deprecation event even at elevated severity (defensive default)", () => {
    const event: TrustEvent = { ...base, type: "deprecation", severity_hint: "medium" };
    expect(riskGate(event, RISK_POLICIES.enterprise).investigated).toBe(false);
  });
});
