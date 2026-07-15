import type { AgentClient, Delivery } from "@croo-network/sdk";
import { env } from "../config/env.js";
import { buildSimulatedDelivery } from "../croo/fixtureDelivery.js";
import { hireAgent, type HireOutcome } from "../croo/hireAgent.js";
import type { OrderEventCorrelator } from "../croo/orderCorrelator.js";
import type { TrustVerdict } from "../merge/types.js";

/**
 * CONFIRMED against a live VERIS Project Due Diligence deliverable
 * (SDK_NOTES.md item 19) — replaces an earlier guess that assumed a
 * structured {tier, trust_score, ...} JSON object. The real deliverable is
 * a formatted PLAIN-TEXT report (deliverableType: "text"; deliverableSchema
 * unused, "[]"), not JSON at all. There's no Zod schema for free text — the
 * boundary validation here is "the expected LEGITIMACY line was found and
 * is a 0-100 number," enforced by throwing when it isn't.
 *
 * The report documents its own score bands every time:
 *   90-100 Strongly Trusted   80-89 Trusted
 *   65-79  Generally Legitimate  50-64 Mixed Signals
 *   30-49  High Risk             0-29 Critical Risk
 * LEGITIMACY is the most stable anchor to parse (one clearly-labeled
 * number); collapsed to our 3-value TrustVerdict by mirroring VERIS's OWN
 * band labels: >=65 (Generally Legitimate and up) -> trusted, 50-64 (Mixed
 * Signals) -> caution, <50 (High Risk + Critical Risk) -> high_risk.
 *
 * CORRECTED (SDK_NOTES.md item 25) after the real node-ipc report: the
 * original cutoffs (65/30) put VERIS's own "High Risk [30-49]" band into
 * our `caution` — understating real risk, the worst direction for a
 * security tool to err. When VERIS prints "HIGH RISK", the verdict is
 * high_risk.
 */
const LEGITIMACY_SCORE_PATTERN = /LEGITIMACY:\s*(\d{1,3})\s*\/\s*100/i;

function normalizeVerisReport(reportText: string): TrustVerdict {
  const match = LEGITIMACY_SCORE_PATTERN.exec(reportText);
  if (!match?.[1]) {
    throw new Error("VERIS report did not contain a parseable 'LEGITIMACY: NN/100' line");
  }
  const score = Number(match[1]);
  if (score < 0 || score > 100) {
    throw new Error(`VERIS LEGITIMACY score ${score} out of the expected 0-100 range`);
  }
  if (score >= 65) return "trusted";
  if (score >= 50) return "caution";
  return "high_risk";
}

/**
 * Parses a VERIS free-text report and normalizes it to a TrustVerdict
 * (FR-11). Throws on an unrecognized shape rather than guessing —
 * hireAgent() catches this as a structured "parse" stage failure.
 */
export function parseVerisDeliverable(delivery: Delivery): TrustVerdict {
  const text = delivery.deliverableText || delivery.deliverableSchema;
  if (!text) {
    throw new Error(`VERIS delivery ${delivery.deliveryId} carried no deliverableText/deliverableSchema`);
  }
  return normalizeVerisReport(text);
}

export interface HireVerisParams {
  client: AgentClient;
  correlator: OrderEventCorrelator;
  /** npm package name, e.g. "evil-dep". */
  packageName: string;
  /** The dependency's own GitHub repo URL. */
  repoUrl: string;
  /** npm homepage/package page — VERIS notes "weak inputs = limited findings", pass what's known. */
  npmHomepage?: string | undefined;
  /** The fixture "raw" block to run through the real parser when simulating. */
  simulatedRaw?: unknown;
  simulate?: boolean | undefined;
  timeouts?: { orderCreatedMs?: number; orderCompletedMs?: number } | undefined;
  /** Optional remaining event budget; the configured per-agent cap still wins when it is lower. */
  maxCostUsdc?: number | undefined;
  /** Defaults to env.VERIS_SERVICE_ID; overridable so callers (and tests) don't depend on .env at import time. */
  serviceId?: string | undefined;
}

/** Hires VERIS Project Due Diligence (trust lens) over CAP for one dependency. */
export async function hireVeris(params: HireVerisParams): Promise<HireOutcome<TrustVerdict>> {
  const serviceId = params.serviceId ?? env.VERIS_SERVICE_ID;
  if (!serviceId && !(params.simulate ?? env.CROO_SIMULATE)) {
    return {
      ok: false,
      simulated: false,
      stage: "negotiate",
      reason: "VERIS_SERVICE_ID is not configured",
    };
  }

  // CONFIRMED against the live Agent Store listing (SDK_NOTES.md item 18):
  // one `text` field whose value is a JSON string describing the project —
  // not the flat {repo, npm_homepage, event_ref} object PRD assumed.
  const website = params.npmHomepage ?? `https://www.npmjs.com/package/${params.packageName}`;
  const projectDescription = {
    type: "project",
    name: params.packageName,
    website,
    github: params.repoUrl,
    docs: website,
  };

  return hireAgent({
    client: params.client,
    correlator: params.correlator,
    serviceId,
    requirements: { text: JSON.stringify(projectDescription) },
    parseDeliverable: parseVerisDeliverable,
    simulate: params.simulate,
    simulatedDelivery: params.simulatedRaw !== undefined ? buildSimulatedDelivery(params.simulatedRaw) : undefined,
    timeouts: params.timeouts,
    maxCostUsdc: Math.min(env.VERIS_MAX_COST_USDC, params.maxCostUsdc ?? Number.POSITIVE_INFINITY),
  });
}
