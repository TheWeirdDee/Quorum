import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentClient, Event, EventStream, EventTypeName } from "@croo-network/sdk";
import { describe, expect, it } from "vitest";
import { buildSimulatedDelivery } from "../../src/croo/fixtureDelivery.js";
import { OrderEventCorrelator } from "../../src/croo/orderCorrelator.js";
import { hireRepoDoctor, parseRepoDoctorDeliverable } from "../../src/hire/repoDoctor.js";

const FIXTURES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures");

function loadJson<T = unknown>(...parts: string[]): T {
  return JSON.parse(readFileSync(path.join(FIXTURES_ROOT, ...parts), "utf-8")) as T;
}

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
 * CONFIRMED real deliverable shape (SDK_NOTES.md item 12), captured directly
 * off a live Repo Doctor listing — not the fixtures/agent-responses/*.json
 * guess, which used a different, flatter shape and is left untouched as a
 * record of what we originally expected.
 */
const realHealthyRaw = {
  overall_score: 82,
  readme_quality: { score: 78, comment: "Clear installation and usage docs." },
  test_coverage_signal: { score: 74, comment: "Test suite present; coverage reporting not configured." },
  dependency_health: { score: 88, comment: "1 outdated dependency, no known vulnerabilities." },
  maintenance_activity: { score: 90, comment: "Active commits within the last week." },
  recommendations: ["Add coverage reporting to CI."],
};

const realUnhealthyRaw = {
  overall_score: 21,
  readme_quality: { score: 10, comment: "No README found." },
  test_coverage_signal: { score: 5, comment: "No tests detected." },
  dependency_health: { score: 30, comment: "14 outdated dependencies." },
  maintenance_activity: { score: 8, comment: "No commits in over 500 days." },
  recommendations: ["Add a README.", "Add a test suite.", "Update dependencies."],
};

describe("parseRepoDoctorDeliverable — against the confirmed real deliverable shape", () => {
  it("normalizes a high overall_score with strong sub-scores to 'healthy'", () => {
    const delivery = buildSimulatedDelivery(realHealthyRaw);
    expect(parseRepoDoctorDeliverable(delivery)).toBe("healthy");
  });

  it("normalizes a low overall_score to 'unhealthy'", () => {
    const delivery = buildSimulatedDelivery(realUnhealthyRaw);
    expect(parseRepoDoctorDeliverable(delivery)).toBe("unhealthy");
  });

  it("downgrades a high overall_score to 'mixed' when one sub-score is critically low", () => {
    const delivery = buildSimulatedDelivery({
      ...realHealthyRaw,
      overall_score: 75,
      test_coverage_signal: { score: 12, comment: "No tests detected despite otherwise active development." },
    });
    expect(parseRepoDoctorDeliverable(delivery)).toBe("mixed");
  });

  it("returns 'mixed' for a mid-range overall_score", () => {
    const delivery = buildSimulatedDelivery({ ...realHealthyRaw, overall_score: 55 });
    expect(parseRepoDoctorDeliverable(delivery)).toBe("mixed");
  });

  it("throws (never silently coerces) on a delivery with no parseable JSON", () => {
    const delivery = buildSimulatedDelivery(null, { deliverableText: "", deliverableSchema: "" });
    expect(() => parseRepoDoctorDeliverable(delivery)).toThrow(/carried no deliverableText/);
  });

  it("throws on malformed JSON rather than guessing a verdict", () => {
    const delivery = buildSimulatedDelivery(null, { deliverableText: "{not json" });
    expect(() => parseRepoDoctorDeliverable(delivery)).toThrow(/not valid JSON/);
  });

  it("throws when overall_score is missing (Zod boundary rejects an unrecognized shape)", () => {
    const delivery = buildSimulatedDelivery({ repo: "https://github.com/acme/thing" });
    expect(() => parseRepoDoctorDeliverable(delivery)).toThrow();
  });

  it("regression guard: the ORIGINAL fixture-guessed shape no longer validates — documents the drift, not a bug", () => {
    const originalGuess = loadJson<{ raw: unknown }>("agent-responses", "repo-doctor.healthy.json");
    const delivery = buildSimulatedDelivery(originalGuess.raw);
    expect(() => parseRepoDoctorDeliverable(delivery)).toThrow();
  });
});

describe("hireRepoDoctor — simulate mode, exercised against the confirmed real shape", () => {
  it("runs the real adapter against a realistic deliverable end to end, no network, $0", async () => {
    const correlator = new OrderEventCorrelator(fakeStream());

    const outcome = await hireRepoDoctor({
      client: fakeClient,
      correlator,
      repoUrl: "https://github.com/acme/evil-dep",
      simulate: true,
      simulatedRaw: realHealthyRaw,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.simulated).toBe(true);
      expect(outcome.verdict).toBe("healthy");
      expect(outcome.tx).toBe("SIMULATED");
      expect(outcome.costUsdc).toBe(0);
    }
  });

  it("fails immediately at the negotiate stage (no network call) when REPO_DOCTOR_SERVICE_ID is unset and not simulating", async () => {
    const correlator = new OrderEventCorrelator(fakeStream());
    const outcome = await hireRepoDoctor({
      client: fakeClient,
      correlator,
      repoUrl: "https://github.com/acme/evil-dep",
      simulate: false,
      serviceId: "", // explicit override — don't depend on agent/.env's ambient REPO_DOCTOR_SERVICE_ID
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.stage).toBe("negotiate");
      expect(outcome.reason).toContain("REPO_DOCTOR_SERVICE_ID");
    }
  });
});
