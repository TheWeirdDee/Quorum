import type { AgentClient, Event, EventStream, EventTypeName } from "@croo-network/sdk";
import { describe, expect, it } from "vitest";
import { buildSimulatedDelivery } from "../../src/croo/fixtureDelivery.js";
import { OrderEventCorrelator } from "../../src/croo/orderCorrelator.js";
import { buildThemisPrompt, hireEscalation, parseThemisDeliverable } from "../../src/hire/escalation.js";

function fakeStream() {
  const handlers = new Map<string, (event: Event) => void>();
  return {
    on: (eventType: EventTypeName | string, handler: (event: Event) => void) => {
      handlers.set(eventType, handler);
    },
  } as unknown as EventStream;
}

const fakeClient = {} as AgentClient;

describe("buildThemisPrompt — assembles the single 'text' field", () => {
  it("includes the explicit question, both verdicts, the trust concern, and sources", () => {
    const text = buildThemisPrompt({
      packageName: "evil-dep",
      healthVerdict: "healthy",
      trustVerdict: "high_risk",
      trustConcern: "advisory reports a postinstall script exfiltrating environment variables",
      sources: ["GHSA-xxxx-demo-0001"],
    });

    expect(text).toContain("Is dependency evil-dep safe to ship in production");
    expect(text).toContain("Repo Doctor");
    expect(text).toContain("healthy");
    expect(text).toContain("VERIS");
    expect(text).toContain("high_risk");
    expect(text).toContain("postinstall script exfiltrating environment variables");
    expect(text).toContain("GHSA-xxxx-demo-0001");
  });

  it("handles an empty sources list without fabricating one", () => {
    const text = buildThemisPrompt({
      packageName: "pkg",
      healthVerdict: "mixed",
      trustVerdict: "caution",
      trustConcern: "unclear",
      sources: [],
    });
    expect(text).toContain("(none provided)");
  });
});

describe("parseThemisDeliverable — JSON shape", () => {
  it("extracts score and review from a structured JSON deliverable", () => {
    const delivery = buildSimulatedDelivery({ score: 0.08, review: "Postinstall confirmed malicious." });
    const result = parseThemisDeliverable(delivery);
    expect(result.score).toBe(0.08);
    expect(result.review).toBe("Postinstall confirmed malicious.");
  });

  it("accepts 'confidence' as a synonym for 'score'", () => {
    const delivery = buildSimulatedDelivery({ confidence: 0.91, review: "No credible risk found." });
    const result = parseThemisDeliverable(delivery);
    expect(result.score).toBe(0.91);
  });

  it("falls back to the raw text as the review when JSON has no 'review' field", () => {
    const delivery = buildSimulatedDelivery({ score: 0.5 });
    const result = parseThemisDeliverable(delivery);
    expect(result.review).toContain('"score":0.5');
  });
});

describe("parseThemisDeliverable — free-text shape (VERIS's real deliverable was free text, Themis's might be too)", () => {
  it("extracts a 'Confidence: 0.NN' line from prose", () => {
    const delivery = buildSimulatedDelivery(
      "THEMIS FACT-CHECK\n\nConfidence: 0.08\n\nThe postinstall script was verified to exfiltrate environment variables.",
    );
    const result = parseThemisDeliverable(delivery);
    expect(result.score).toBe(0.08);
    expect(result.review).toContain("exfiltrate environment variables");
  });

  it("extracts a 'Score: 0.NN' line from prose", () => {
    const delivery = buildSimulatedDelivery("Review complete.\nScore: 0.92\nNo evidence of malicious behavior found.");
    const result = parseThemisDeliverable(delivery);
    expect(result.score).toBe(0.92);
  });
});

describe("parseThemisDeliverable — never coerces an invalid score (Zod boundary)", () => {
  it("throws when the score is out of the [0,1] range (>1)", () => {
    const delivery = buildSimulatedDelivery({ score: 1.5, review: "..." });
    expect(() => parseThemisDeliverable(delivery)).toThrow();
  });

  it("throws when the score is out of the [0,1] range (negative)", () => {
    const delivery = buildSimulatedDelivery({ score: -0.2, review: "..." });
    expect(() => parseThemisDeliverable(delivery)).toThrow();
  });

  it("throws when no score can be found anywhere in the deliverable", () => {
    const delivery = buildSimulatedDelivery("This review has no numeric verdict at all.");
    expect(() => parseThemisDeliverable(delivery)).toThrow(/did not contain a parseable confidence score/);
  });

  it("throws (never silently coerces) on a delivery with no text at all", () => {
    const delivery = buildSimulatedDelivery(null, { deliverableText: "", deliverableSchema: "" });
    expect(() => parseThemisDeliverable(delivery)).toThrow(/carried no deliverableText/);
  });
});

describe("hireEscalation — simulate mode", () => {
  it("runs the real adapter end to end against a simulated Themis report, no network, $0", async () => {
    const correlator = new OrderEventCorrelator(fakeStream());

    const outcome = await hireEscalation({
      client: fakeClient,
      correlator,
      packageName: "evil-dep",
      healthVerdict: "healthy",
      trustVerdict: "high_risk",
      trustConcern: "postinstall exfiltrates environment variables",
      sources: ["GHSA-xxxx-demo-0001"],
      simulate: true,
      simulatedRaw: "Confidence: 0.08\n\nConfirmed malicious postinstall.",
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.simulated).toBe(true);
      expect(outcome.verdict.score).toBe(0.08);
      expect(outcome.verdict.review).toContain("Confirmed malicious postinstall");
      expect(outcome.tx).toBe("SIMULATED");
      expect(outcome.costUsdc).toBe(0);
    }
  });

  it("fails immediately at the negotiate stage (no network call) when ESCALATION_AGENT_SERVICE_ID is unset and not simulating", async () => {
    const correlator = new OrderEventCorrelator(fakeStream());
    const outcome = await hireEscalation({
      client: fakeClient,
      correlator,
      packageName: "evil-dep",
      healthVerdict: "healthy",
      trustVerdict: "high_risk",
      trustConcern: "test",
      sources: [],
      simulate: false,
      serviceId: "", // explicit override — don't depend on agent/.env's ambient ESCALATION_AGENT_SERVICE_ID
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.stage).toBe("negotiate");
      expect(outcome.reason).toContain("ESCALATION_AGENT_SERVICE_ID");
    }
  });
});
