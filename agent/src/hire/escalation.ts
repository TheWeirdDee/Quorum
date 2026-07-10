import type { AgentClient, Delivery } from "@croo-network/sdk";
import { z } from "zod";
import { env } from "../config/env.js";
import { buildSimulatedDelivery } from "../croo/fixtureDelivery.js";
import { hireAgent, type HireOutcome } from "../croo/hireAgent.js";
import type { OrderEventCorrelator } from "../croo/orderCorrelator.js";
import type { HealthVerdict, TrustVerdict } from "../merge/types.js";

/** Themis's answer: how confident it is that shipping is SAFE (0..1), plus its review reasoning. */
export interface ThemisResult {
  score: number;
  review: string;
}

export interface ThemisPromptInput {
  packageName: string;
  healthVerdict: HealthVerdict;
  trustVerdict: TrustVerdict;
  /** The specific trust concern to fact-check — event.context.detail is the natural source (the concrete claim driving the disagreement). */
  trustConcern: string;
  /** CVE/GHSA/advisory identifiers backing the concern. */
  sources: string[];
}

/**
 * Assembles the single `text` field Themis's Fact-Check service takes:
 * (a) the disputed question, explicit; (b) VERIS's trust concern;
 * (c) Repo Doctor's health verdict; (d) sources.
 *
 * Known limitation: hireRepoDoctor()/hireVeris() currently return only the
 * normalized verdict enum, not the raw per-lens signal text (M3 scope) — so
 * (b)/(c) here are built from the verdict + the event's own context.detail,
 * not a richer per-agent summary. Good enough to fact-check the disputed
 * claim; a future improvement would thread raw signals through from M3's
 * adapters for a richer prompt.
 */
export function buildThemisPrompt(input: ThemisPromptInput): string {
  return [
    `Is dependency ${input.packageName} safe to ship in production, given a healthy codebase but the following trust concerns?`,
    "",
    `Repo Doctor (codebase health lens): ${input.healthVerdict}.`,
    `VERIS (supply-chain trust lens): ${input.trustVerdict}. Concern: ${input.trustConcern}`,
    "",
    `Sources: ${input.sources.length > 0 ? input.sources.join(", ") : "(none provided)"}`,
  ].join("\n");
}

/**
 * BEST GUESS at Themis's deliverable shape — Fact-Check is confirmed live
 * (ESCALATION_AGENT_SERVICE_ID set) but no real call has been made yet in
 * this session, so this is unconfirmed, same status Repo Doctor's and
 * VERIS's adapters started in. Tries structured JSON first (a `score` or
 * `confidence` field), falls back to scanning free text for a labeled
 * number — VERIS's real deliverable turned out to be free text (SDK_NOTES.md
 * item 19), so Themis's easily could be too. Whichever it is, this never
 * silently coerces: an unparseable or out-of-[0,1]-range score throws,
 * caught by hireAgent() as a structured "parse" stage failure.
 */
const themisJsonSchema = z
  .object({
    score: z.number().optional(),
    confidence: z.number().optional(),
    review: z.string().optional(),
  })
  .passthrough();

const SCORE_IN_TEXT_PATTERN = /(?:confidence|score)[^\d\-]{0,20}(-?\d*\.?\d+)/i;

function extractScoreFromText(text: string): number | undefined {
  const match = SCORE_IN_TEXT_PATTERN.exec(text);
  if (!match?.[1]) return undefined;
  const value = Number(match[1]);
  return Number.isNaN(value) ? undefined : value;
}

export function parseThemisDeliverable(delivery: Delivery): ThemisResult {
  const text = delivery.deliverableText || delivery.deliverableSchema;
  if (!text) {
    throw new Error(`Themis delivery ${delivery.deliveryId} carried no deliverableText/deliverableSchema`);
  }

  let rawScore: number | undefined;
  let review = text;

  try {
    const parsedJson = JSON.parse(text) as unknown;
    const validated = themisJsonSchema.parse(parsedJson);
    rawScore = validated.score ?? validated.confidence;
    if (validated.review) review = validated.review;
  } catch {
    // Not JSON (or didn't match) — fall through to free-text extraction below.
  }

  if (rawScore === undefined) {
    rawScore = extractScoreFromText(text);
    // Free-text fallback: strip the matched "Confidence: 0.NN" / "Score: 0.NN"
    // line out of the review so it isn't shown twice (once as the parsed
    // score, once verbatim inside the review text).
    if (rawScore !== undefined) {
      review = text.replace(SCORE_IN_TEXT_PATTERN, "").replace(/\n{3,}/g, "\n\n").trim();
    }
  }

  if (rawScore === undefined) {
    throw new Error(`Themis delivery ${delivery.deliveryId} did not contain a parseable confidence score`);
  }

  // Never coerce/clamp an out-of-range score — a real Zod boundary failure, not silently fixed.
  const score = z.number().min(0).max(1).parse(rawScore);
  return { score, review };
}

export interface HireEscalationParams {
  client: AgentClient;
  correlator: OrderEventCorrelator;
  packageName: string;
  healthVerdict: HealthVerdict;
  trustVerdict: TrustVerdict;
  trustConcern: string;
  sources: string[];
  /** The fixture "raw" block (JSON object OR plain text — either is accepted, see buildSimulatedDelivery) to run through the real parser when simulating. */
  simulatedRaw?: unknown;
  simulate?: boolean | undefined;
  timeouts?: { orderCreatedMs?: number; orderCompletedMs?: number } | undefined;
  /** Defaults to env.ESCALATION_AGENT_SERVICE_ID; overridable so callers (and tests) don't depend on .env at import time. */
  serviceId?: string | undefined;
}

/** Hires Themis (Fact-Check) over CAP as the escalation tiebreaker. */
export async function hireEscalation(params: HireEscalationParams): Promise<HireOutcome<ThemisResult>> {
  const serviceId = params.serviceId ?? env.ESCALATION_AGENT_SERVICE_ID;
  if (!serviceId && !(params.simulate ?? env.CROO_SIMULATE)) {
    return {
      ok: false,
      simulated: false,
      stage: "negotiate",
      reason: "ESCALATION_AGENT_SERVICE_ID is not configured",
    };
  }

  const text = buildThemisPrompt({
    packageName: params.packageName,
    healthVerdict: params.healthVerdict,
    trustVerdict: params.trustVerdict,
    trustConcern: params.trustConcern,
    sources: params.sources,
  });

  return hireAgent({
    client: params.client,
    correlator: params.correlator,
    serviceId,
    requirements: { text },
    parseDeliverable: parseThemisDeliverable,
    simulate: params.simulate,
    simulatedDelivery: params.simulatedRaw !== undefined ? buildSimulatedDelivery(params.simulatedRaw) : undefined,
    timeouts: params.timeouts,
    maxCostUsdc: env.ESCALATION_MAX_COST_USDC,
  });
}
