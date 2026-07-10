import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RISK_POLICIES } from "../../src/config/riskPolicy.js";
import { loadFixtureEvents } from "../../src/detector/index.js";
import type { TrustEvent } from "../../src/detector/types.js";
import { riskGate } from "../../src/gate/riskGate.js";
import { merge } from "../../src/merge/merge.js";
import type { HealthVerdict, TrustVerdict } from "../../src/merge/types.js";
import { serializeDecision } from "../../src/decision/serialize.js";

const FIXTURES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures");

function loadJson<T = unknown>(...parts: string[]): T {
  return JSON.parse(readFileSync(path.join(FIXTURES_ROOT, ...parts), "utf-8")) as T;
}

interface AgentResponseFixture {
  normalized: { agent: string; verdict: string; signals?: string[] };
  cap: { order_id: string; tx: string; cost_usdc: number };
}

const events = loadFixtureEvents();
const patchEvent = events.find((e) => e.type === "deprecation") as TrustEvent;
const cveEvent = events.find((e) => e.type === "new_cve") as TrustEvent;
const maliciousEvent = events.find((e) => e.type === "malicious_release") as TrustEvent;

describe("decision serializer — fixtures/expected/decision.archived.json (low_severity_patch)", () => {
  it("matches the expected archived decision FULLY", () => {
    const gate = riskGate(patchEvent, RISK_POLICIES.balanced);
    expect(gate.investigated).toBe(false);

    const { _note, ...expected } = loadJson<Record<string, unknown>>("expected", "decision.archived.json");
    void _note;

    const decision = serializeDecision({
      investigated: false,
      dependency: patchEvent.dependency,
      event: {
        type: patchEvent.type,
        detail: "docs-only patch on a devDependency; no advisory",
        source: patchEvent.source,
        ref: patchEvent.ref,
        severity_hint: patchEvent.severity_hint,
      },
      gateReason: gate.reason,
      decidedAt: expected.decided_at as string,
    });

    expect(decision).toEqual(expected);
  });
});

describe("decision serializer — fixtures/expected/decision.agreement_no_escalation.json (new_cve, balanced)", () => {
  it("gate investigates the high-severity CVE on a production dependency", () => {
    const gate = riskGate(cveEvent, RISK_POLICIES.balanced);
    expect(gate.investigated).toBe(true);
    expect(gate.reason).toBe("high-severity CVE on a production dependency");
  });

  it("merges repo-doctor.unhealthy + veris.caution into DO_NOT_SHIP at 0.85 with no escalation needed", () => {
    const repoDoctor = loadJson<AgentResponseFixture>("agent-responses", "repo-doctor.unhealthy.json");
    const veris = loadJson<AgentResponseFixture>("agent-responses", "veris.caution.json");

    const result = merge(
      repoDoctor.normalized.verdict as HealthVerdict,
      veris.normalized.verdict as TrustVerdict,
      RISK_POLICIES.balanced,
      { healthSignals: repoDoctor.normalized.signals, trustSignals: veris.normalized.signals },
    );

    expect(result.decision).toBe("DO_NOT_SHIP");
    expect(result.confidence).toBe(0.85);
    expect(result.needs_escalation).toBe(false);
  });

  it("serializes to a schema-valid decision whose spend/receipts match the fixture (both lenses purchased, none escalated)", () => {
    const gate = riskGate(cveEvent, RISK_POLICIES.balanced);
    const repoDoctor = loadJson<AgentResponseFixture>("agent-responses", "repo-doctor.unhealthy.json");
    const veris = loadJson<AgentResponseFixture>("agent-responses", "veris.caution.json");
    const mergeResult = merge(
      repoDoctor.normalized.verdict as HealthVerdict,
      veris.normalized.verdict as TrustVerdict,
      RISK_POLICIES.balanced,
      { healthSignals: repoDoctor.normalized.signals, trustSignals: veris.normalized.signals },
    );

    const decision = serializeDecision({
      investigated: true,
      dependency: cveEvent.dependency,
      event: {
        type: cveEvent.type,
        detail: "prototype pollution, no patch; last commit 19mo ago",
        source: cveEvent.source,
        ref: cveEvent.ref,
        severity_hint: cveEvent.severity_hint,
      },
      gateReason: gate.reason,
      merge: mergeResult,
      lenses: {
        health: {
          agent: repoDoctor.normalized.agent,
          verdict: repoDoctor.normalized.verdict as HealthVerdict,
          order_id: repoDoctor.cap.order_id,
          tx: repoDoctor.cap.tx,
          cost_usdc: repoDoctor.cap.cost_usdc,
        },
        trust: {
          agent: veris.normalized.agent,
          verdict: veris.normalized.verdict as TrustVerdict,
          order_id: veris.cap.order_id,
          tx: veris.cap.tx,
          cost_usdc: veris.cap.cost_usdc,
        },
      },
    });

    expect(decision.decision).toBe("DO_NOT_SHIP");
    expect(decision.confidence).toBe(0.85);
    expect(decision.total_spend_usdc).toBeCloseTo(0.11, 5);
    expect(decision.receipts).toEqual(["0xMOCK_REPO_DOCTOR_TX2", "0xMOCK_VERIS_TX2"]);
  });
});

describe("decision serializer — fixtures/expected/decision.malicious_release.json PRE-escalation (enterprise)", () => {
  it("gate investigates the critical malicious_release on a production dependency", () => {
    const gate = riskGate(maliciousEvent, RISK_POLICIES.enterprise);
    expect(gate.investigated).toBe(true);
    expect(gate.reason).toBe("critical severity on a production dependency");
  });

  it("merges repo-doctor.healthy + veris.high_risk into the disagreement cell: REVIEW, 0.60, needs_escalation", () => {
    const repoDoctor = loadJson<AgentResponseFixture>("agent-responses", "repo-doctor.healthy.json");
    const veris = loadJson<AgentResponseFixture>("agent-responses", "veris.high_risk.json");

    const result = merge(
      repoDoctor.normalized.verdict as HealthVerdict,
      veris.normalized.verdict as TrustVerdict,
      RISK_POLICIES.enterprise,
      { healthSignals: repoDoctor.normalized.signals, trustSignals: veris.normalized.signals },
    );

    expect(result.decision).toBe("REVIEW");
    expect(result.confidence).toBe(0.6);
    expect(result.needs_escalation).toBe(true);
    expect(result.disagreement).not.toBe("");
    expect(result.disagreement).toContain("Repo Doctor");
    expect(result.disagreement).toContain("VERIS");
    // NOT the post-escalation 0.94 final — that's milestone 4.
    expect(result.confidence).not.toBe(0.94);
  });

  it("serializes a schema-valid PRE-escalation snapshot: no third receipt, no fabricated spend", () => {
    const gate = riskGate(maliciousEvent, RISK_POLICIES.enterprise);
    const repoDoctor = loadJson<AgentResponseFixture>("agent-responses", "repo-doctor.healthy.json");
    const veris = loadJson<AgentResponseFixture>("agent-responses", "veris.high_risk.json");
    const mergeResult = merge(
      repoDoctor.normalized.verdict as HealthVerdict,
      veris.normalized.verdict as TrustVerdict,
      RISK_POLICIES.enterprise,
      { healthSignals: repoDoctor.normalized.signals, trustSignals: veris.normalized.signals },
    );

    const decision = serializeDecision({
      investigated: true,
      dependency: maliciousEvent.dependency,
      event: {
        type: maliciousEvent.type,
        detail: "postinstall exfiltrating env vars added in 2.4.1",
        source: maliciousEvent.source,
        ref: maliciousEvent.ref,
        severity_hint: maliciousEvent.severity_hint,
      },
      gateReason: gate.reason,
      merge: mergeResult,
      lenses: {
        health: {
          agent: repoDoctor.normalized.agent,
          verdict: repoDoctor.normalized.verdict as HealthVerdict,
          order_id: repoDoctor.cap.order_id,
          tx: repoDoctor.cap.tx,
          cost_usdc: repoDoctor.cap.cost_usdc,
        },
        trust: {
          agent: veris.normalized.agent,
          verdict: veris.normalized.verdict as TrustVerdict,
          order_id: veris.cap.order_id,
          tx: veris.cap.tx,
          cost_usdc: veris.cap.cost_usdc,
        },
      },
    });

    expect(decision.decision).toBe("REVIEW");
    expect(decision.confidence).toBe(0.6);
    expect(decision.escalation.triggered).toBe(false);
    expect(decision.total_spend_usdc).toBeCloseTo(0.11, 5);
    expect(decision.receipts).toHaveLength(2);
    expect(decision.receipts).not.toContain("0xMOCK_ESCALATION_TX");
  });
});
