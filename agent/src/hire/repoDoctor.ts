import type { AgentClient, Delivery } from "@croo-network/sdk";
import { z } from "zod";
import { env } from "../config/env.js";
import { buildSimulatedDelivery } from "../croo/fixtureDelivery.js";
import { hireAgent, type HireOutcome } from "../croo/hireAgent.js";
import type { OrderEventCorrelator } from "../croo/orderCorrelator.js";
import { parseGithubUrl } from "../detector/sources/github.js";
import type { HealthVerdict } from "../merge/types.js";

/**
 * CONFIRMED against a live Repo Doctor deliverable (SDK_NOTES.md item 12) —
 * this replaced an earlier guess based on fixtures/agent-responses/
 * repo-doctor.*.json, which used a flatter, differently-named shape
 * (health_score, has_tests, commit_hygiene, ...). The fixtures are left
 * as-is (a record of the original guess, per SCENARIOS.md); this schema is
 * what actually gets validated at runtime.
 */
const scoreCommentSchema = z.object({
  score: z.number().min(0).max(100),
  comment: z.string(),
});

const repoDoctorRawSchema = z.object({
  overall_score: z.number().min(0).max(100),
  readme_quality: scoreCommentSchema,
  test_coverage_signal: scoreCommentSchema,
  dependency_health: scoreCommentSchema,
  maintenance_activity: scoreCommentSchema,
  recommendations: z.array(z.string()),
});
type RepoDoctorRaw = z.infer<typeof repoDoctorRawSchema>;

/**
 * Primary signal is overall_score (same 70/40 boundary as the original
 * guess). Sub-scores act as a floor: a high overall_score is downgraded to
 * "mixed" if any single sub-score is critically low (<30) — a repo can look
 * good on average while hiding one serious weakness (e.g. zero test
 * coverage) that overall_score alone would mask.
 */
function normalizeRepoDoctorRaw(raw: RepoDoctorRaw): HealthVerdict {
  if (raw.overall_score < 40) return "unhealthy";

  const subScores = [
    raw.readme_quality.score,
    raw.test_coverage_signal.score,
    raw.dependency_health.score,
    raw.maintenance_activity.score,
  ];
  const worstSubScore = Math.min(...subScores);

  if (raw.overall_score >= 70) return worstSubScore < 30 ? "mixed" : "healthy";
  return "mixed";
}

function extractJsonPayload(delivery: Delivery): unknown {
  const text = delivery.deliverableText || delivery.deliverableSchema;
  if (!text) {
    throw new Error(`Repo Doctor delivery ${delivery.deliveryId} carried no deliverableText/deliverableSchema`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Repo Doctor delivery ${delivery.deliveryId} was not valid JSON: ${message}`);
  }
}

/**
 * Parses + Zod-validates a Repo Doctor deliverable and normalizes it to a
 * HealthVerdict (FR-10). Throws on an unrecognized shape rather than
 * guessing — hireAgent() catches this as a structured "parse" stage failure.
 */
export function parseRepoDoctorDeliverable(delivery: Delivery): HealthVerdict {
  const payload = extractJsonPayload(delivery);
  const raw = repoDoctorRawSchema.parse(payload);
  return normalizeRepoDoctorRaw(raw);
}

export interface HireRepoDoctorParams {
  client: AgentClient;
  correlator: OrderEventCorrelator;
  /** The dependency's own GitHub repo URL (not the monitored repo) — Repo Doctor needs a repo URL, not a package name. */
  repoUrl: string;
  /** The fixture "raw" block to run through the real parser when simulating. */
  simulatedRaw?: unknown;
  simulate?: boolean | undefined;
  timeouts?: { orderCreatedMs?: number; orderCompletedMs?: number } | undefined;
  /** Defaults to env.REPO_DOCTOR_SERVICE_ID; overridable so callers (and tests) don't depend on .env at import time. */
  serviceId?: string | undefined;
}

/** Hires Repo Doctor (health lens) over CAP for one dependency's GitHub repo. */
export async function hireRepoDoctor(params: HireRepoDoctorParams): Promise<HireOutcome<HealthVerdict>> {
  const serviceId = params.serviceId ?? env.REPO_DOCTOR_SERVICE_ID;
  if (!serviceId && !(params.simulate ?? env.CROO_SIMULATE)) {
    return {
      ok: false,
      simulated: false,
      stage: "negotiate",
      reason: "REPO_DOCTOR_SERVICE_ID is not configured",
    };
  }

  // Confirmed against the live Agent Store listing (not SPEC's guess of a
  // single `repo` URL field): the "Repo Health Check" order form has two
  // separate required fields, Owner and Repo.
  const { owner, repo } = parseGithubUrl(params.repoUrl);

  return hireAgent({
    client: params.client,
    correlator: params.correlator,
    serviceId,
    requirements: { owner, repo },
    parseDeliverable: parseRepoDoctorDeliverable,
    simulate: params.simulate,
    simulatedDelivery: params.simulatedRaw !== undefined ? buildSimulatedDelivery(params.simulatedRaw) : undefined,
    timeouts: params.timeouts,
    maxCostUsdc: env.REPO_DOCTOR_MAX_COST_USDC,
  });
}
