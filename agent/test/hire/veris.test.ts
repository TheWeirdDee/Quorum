import type { AgentClient, Event, EventStream, EventTypeName, NegotiateOrderRequest } from "@croo-network/sdk";
import { describe, expect, it } from "vitest";
import { buildSimulatedDelivery } from "../../src/croo/fixtureDelivery.js";
import { OrderEventCorrelator } from "../../src/croo/orderCorrelator.js";
import { hireVeris, parseVerisDeliverable } from "../../src/hire/veris.js";

function fakeStream() {
  const handlers = new Map<string, (event: Event) => void>();
  return {
    on: (eventType: EventTypeName | string, handler: (event: Event) => void) => {
      handlers.set(eventType, handler);
    },
  } as unknown as EventStream;
}

const fakeClient = {} as AgentClient;

/**
 * CONFIRMED real deliverable (SDK_NOTES.md item 19), captured from a live
 * VERIS Project Due Diligence order for "evil-dep" — a formatted plain-text
 * report, not JSON. Trimmed to the parts the parser cares about; the real
 * report is much longer (evidence sources, sub-agent contributions, etc.).
 */
const realCriticalRiskReport = `VERIS TRUST REPORT
══════════════════════════════════════════════
Subject:          evil-dep
Entity Class:     General Project
Website:          https://www.npmjs.com/package/evil-dep
GitHub:           https://github.com/acme/evil-dep
══════════════════════════════════════════════
LEGITIMACY:   22/100  ████░░░░░░░░░░░░░░░░
  Identity:       0/100
  Transparency:   37/100
MATURITY:     29/100  ██████░░░░░░░░░░░░░░
CONFIDENCE:   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░ 72%
OP. RISK:     Low

RECOMMENDATION:  ⛔ CRITICAL RISK  [Band: 0-29]
══════════════════════════════════════════════
SCORE BANDS
  90-100  Strongly Trusted    80-89  Trusted
  65-79   Generally Legitimate  50-64  Mixed Signals
  30-49   High Risk            0-29   Critical Risk
  N/A     Insufficient Data
══════════════════════════════════════════════`;

function reportWithLegitimacy(score: number): string {
  return realCriticalRiskReport.replace(/LEGITIMACY:\s*\d{1,3}\/100/, `LEGITIMACY:   ${score}/100`);
}

describe("parseVerisDeliverable — against the confirmed real text-report format", () => {
  it("normalizes the real captured critical-risk report to 'high_risk'", () => {
    const delivery = buildSimulatedDelivery(realCriticalRiskReport);
    expect(parseVerisDeliverable(delivery)).toBe("high_risk");
  });

  it.each([
    [95, "trusted"],
    [85, "trusted"],
    [70, "trusted"],
    [65, "trusted"], // VERIS's own stated lower bound of "Generally Legitimate"
    [64, "caution"], // top of "Mixed Signals"
    [50, "caution"], // bottom of "Mixed Signals"
    [49, "high_risk"], // top of VERIS's own "High Risk" band — must be OUR high_risk (item 25)
    [30, "high_risk"], // bottom of "High Risk"
    [29, "high_risk"], // "Critical Risk"
    [0, "high_risk"],
  ] as const)("LEGITIMACY %i/100 -> %s (mirrors VERIS's own band labels)", (score, expected) => {
    const delivery = buildSimulatedDelivery(reportWithLegitimacy(score));
    expect(parseVerisDeliverable(delivery)).toBe(expected);
  });

  it("REGRESSION (item 25, from the real node-ipc run): legitimacy 34/100 with VERIS's own label 'HIGH RISK' must yield high_risk, not caution", () => {
    // Trimmed verbatim from the real paid deliverable (order bad24e61-...,
    // 2026-07-03) — the run where our old 65/30 cutoffs understated VERIS's
    // own "✗ HIGH RISK [Band: 30-49]" recommendation to `caution`.
    const realNodeIpcReport = [
      "VERIS TRUST REPORT",
      "══════════════════════════════════════════════",
      "Subject:          node-ipc",
      "Entity Class:     L1/L2 Blockchain",
      "GitHub:           https://github.com/RIAEvangelist/node-ipc",
      "══════════════════════════════════════════════",
      "LEGITIMACY:   34/100  ███████░░░░░░░░░░░░░",
      "  Identity:       0/100",
      "  Reputation:     9/100",
      "MATURITY:     27/100  █████░░░░░░░░░░░░░░░",
      "CONFIDENCE:   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░ 72%",
      "",
      "RECOMMENDATION:  ✗ HIGH RISK  [Band: 30-49]",
      "Significant legitimacy gaps. Proceed only with extensive independent verification.",
    ].join("\n");
    const delivery = buildSimulatedDelivery(realNodeIpcReport);
    expect(parseVerisDeliverable(delivery)).toBe("high_risk");
  });

  it("throws (never silently coerces) on a delivery with no report text", () => {
    const delivery = buildSimulatedDelivery(null, { deliverableText: "", deliverableSchema: "" });
    expect(() => parseVerisDeliverable(delivery)).toThrow(/carried no deliverableText/);
  });

  it("throws when the report has no parseable LEGITIMACY line, rather than guessing", () => {
    const delivery = buildSimulatedDelivery("Some unrelated text with no score in it.");
    expect(() => parseVerisDeliverable(delivery)).toThrow(/parseable 'LEGITIMACY/);
  });

  it("regression guard: the ORIGINAL JSON-shaped fixture guess no longer parses — documents the drift, not a bug", () => {
    const originalGuess = { subject: "https://github.com/acme/evil-dep", trust_score: 28, tier: "high_risk" };
    const delivery = buildSimulatedDelivery(JSON.stringify(originalGuess));
    expect(() => parseVerisDeliverable(delivery)).toThrow(/parseable 'LEGITIMACY/);
  });
});

describe("hireVeris — requirements mapping (SDK_NOTES.md item 18: single 'text' field, JSON-string value)", () => {
  it("sends requirements.text as a JSON string matching {type, name, website, github, docs}", async () => {
    let capturedRequirements: string | undefined;
    const client = {
      negotiateOrder: async (req: NegotiateOrderRequest) => {
        capturedRequirements = req.requirements;
        return { negotiationId: "neg-1" };
      },
      listOrders: async () => [],
      getOrder: async () => ({ status: "created" }),
    } as unknown as AgentClient;

    const correlator = new OrderEventCorrelator(fakeStream());
    void hireVeris({
      client,
      correlator,
      packageName: "evil-dep",
      repoUrl: "https://github.com/acme/evil-dep",
      npmHomepage: "https://www.npmjs.com/package/evil-dep",
      simulate: false,
      timeouts: { orderCreatedMs: 50 },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(capturedRequirements).toBeDefined();
    // negotiateOrder's `requirements` is hireAgent's JSON.stringify(the
    // {text} object) — one level of parsing gets {text}, a second gets the
    // actual project description VERIS reads.
    const outer = JSON.parse(capturedRequirements as string) as { text: string };
    const projectDescription = JSON.parse(outer.text) as Record<string, unknown>;
    expect(projectDescription).toEqual({
      type: "project",
      name: "evil-dep",
      website: "https://www.npmjs.com/package/evil-dep",
      github: "https://github.com/acme/evil-dep",
      docs: "https://www.npmjs.com/package/evil-dep",
    });
  });

  it("falls back to the npm package page when npmHomepage isn't supplied", async () => {
    let capturedRequirements: string | undefined;
    const client = {
      negotiateOrder: async (req: NegotiateOrderRequest) => {
        capturedRequirements = req.requirements;
        return { negotiationId: "neg-1" };
      },
      listOrders: async () => [],
      getOrder: async () => ({ status: "created" }),
    } as unknown as AgentClient;

    const correlator = new OrderEventCorrelator(fakeStream());
    void hireVeris({
      client,
      correlator,
      packageName: "left-pad",
      repoUrl: "https://github.com/stringops/left-pad",
      simulate: false,
      timeouts: { orderCreatedMs: 50 },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    const outer = JSON.parse(capturedRequirements as string) as { text: string };
    const projectDescription = JSON.parse(outer.text) as Record<string, unknown>;
    expect(projectDescription["website"]).toBe("https://www.npmjs.com/package/left-pad");
  });
});

describe("hireVeris — simulate mode, exercised against the real captured report", () => {
  it("runs the real adapter against the real captured report end to end, no network, $0", async () => {
    const correlator = new OrderEventCorrelator(fakeStream());

    const outcome = await hireVeris({
      client: fakeClient,
      correlator,
      packageName: "evil-dep",
      repoUrl: "https://github.com/acme/evil-dep",
      simulate: true,
      simulatedRaw: realCriticalRiskReport,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.simulated).toBe(true);
      expect(outcome.verdict).toBe("high_risk");
      expect(outcome.tx).toBe("SIMULATED");
      expect(outcome.costUsdc).toBe(0);
    }
  });

  it("fails immediately at the negotiate stage (no network call) when VERIS_SERVICE_ID is unset and not simulating", async () => {
    const correlator = new OrderEventCorrelator(fakeStream());
    const outcome = await hireVeris({
      client: fakeClient,
      correlator,
      packageName: "evil-dep",
      repoUrl: "https://github.com/acme/evil-dep",
      simulate: false,
      serviceId: "", // explicit override — don't depend on agent/.env's ambient VERIS_SERVICE_ID
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.stage).toBe("negotiate");
      expect(outcome.reason).toContain("VERIS_SERVICE_ID");
    }
  });
});
