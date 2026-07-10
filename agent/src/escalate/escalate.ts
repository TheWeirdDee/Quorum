import type { AgentClient } from "@croo-network/sdk";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import type { RiskPolicy } from "../config/riskPolicy.js";
import type { OrderEventCorrelator } from "../croo/orderCorrelator.js";
import { hireEscalation } from "../hire/escalation.js";
import type { HealthVerdict, MergeDecision, MergeResult, TrustVerdict } from "../merge/types.js";

export interface EscalationParams {
  mergeResult: MergeResult;
  policy: RiskPolicy;
  /** Sum of the health + trust lens costs already spent on this event. */
  spentSoFar: number;
  client: AgentClient;
  correlator: OrderEventCorrelator;
  packageName: string;
  healthVerdict: HealthVerdict;
  trustVerdict: TrustVerdict;
  trustConcern: string;
  sources: string[];
  simulate?: boolean | undefined;
  simulatedRaw?: unknown;
  timeouts?: { orderCreatedMs?: number; orderCompletedMs?: number } | undefined;
  serviceId?: string | undefined;
}

export interface EscalationOutcome {
  triggered: boolean;
  reason: string;
  agent?: string | undefined;
  order_id?: string | undefined;
  tx?: string | undefined;
  cost_usdc?: number | undefined;
  /** Present only when the escalation actually resolved the disagreement toward a side. */
  resolvedDecision?: MergeDecision | undefined;
  resolvedConfidence?: number | undefined;
  /** Themis's review text — present whenever the hire succeeded, whether or not it was decisive enough to resolve anything. */
  review?: string | undefined;
}

/**
 * Themis answers "how confident are you this is SAFE to ship?" (0..1) — NOT
 * "how risky is this." Polarity matters: a LOW score means Themis could NOT
 * verify safety, which CONFIRMS the trust lens's concern → resolve toward
 * DO_NOT_SHIP. A HIGH score means Themis verified it's safe, confirming the
 * health lens → resolve toward SHIP. Getting this backwards would have a
 * low safety score push toward SHIP, which is exactly wrong — this is the
 * one place a subtle inversion would quietly break the demo, so it's worth
 * reading twice: `score < 0.5` is the DO_NOT_SHIP branch.
 *
 * decisiveness = |score - 0.5| * 2 → 0 at the midpoint (Themis genuinely
 * uncertain), 1 at either extreme (Themis fully confident one way or the
 * other). Below ESCALATION_MIN_DECISIVENESS, Themis is inconclusive: the
 * pre-escalation decision/confidence stand, unchanged — no fabrication.
 *
 * Otherwise, final confidence BLENDS Themis's decisiveness with the
 * pre-escalation confidence: `preConfidence + (1 - preConfidence) *
 * decisiveness`. This is deliberately not just `1 - score` or `score` alone
 * — a maximally decisive Themis answer (score 0 or 1) pushes confidence
 * toward 1.0 but starts from where the two-lens disagreement already stood,
 * rather than discarding that context. A neutral score (0.5) leaves
 * confidence exactly where merge() left it, by construction (decisiveness=0).
 */
function resolveWithThemis(
  score: number,
  preConfidence: number,
): { decision: MergeDecision; confidence: number } | undefined {
  const decisiveness = Math.abs(score - 0.5) * 2;
  if (decisiveness < env.ESCALATION_MIN_DECISIVENESS) return undefined;

  const decision: MergeDecision = score < 0.5 ? "DO_NOT_SHIP" : "SHIP";
  const confidence = preConfidence + (1 - preConfidence) * decisiveness;
  return { decision, confidence };
}

/**
 * The M4 escalation engine (SPEC §7, FR-14/15/16), wired to Themis
 * (Fact-Check, confirmed live). Pure orchestration around the existing
 * hireAgent() primitive — never recomputes merge() itself, only consumes
 * its needs_escalation signal.
 *
 * Trigger: needs_escalation === true AND spentSoFar + assumed cost <= budget
 * cap. Buys ONE opinion (ESCALATION_MAX_ATTEMPTS defaults to 1; no retry
 * loop exists in M4). Degrades gracefully in every failure mode — empty
 * slot, hire failure, budget exhaustion, inconclusive resolution — by
 * returning the honest pre-escalation state, never a fabricated one.
 */
export async function escalate(params: EscalationParams): Promise<EscalationOutcome> {
  const { mergeResult, policy } = params;

  if (!mergeResult.needs_escalation) {
    return { triggered: false, reason: "" };
  }

  if (env.ESCALATION_MAX_ATTEMPTS < 1) {
    return {
      triggered: false,
      reason: `confidence ${mergeResult.confidence.toFixed(2)} < target ${policy.confidence_target.toFixed(2)}; escalation disabled (ESCALATION_MAX_ATTEMPTS=0) — alerting with honest pre-escalation confidence`,
    };
  }

  const assumedCost = env.ESCALATION_ASSUMED_COST_USDC;
  const budgetRemaining = policy.budget_cap_usdc - params.spentSoFar;

  if (params.spentSoFar + assumedCost > policy.budget_cap_usdc) {
    const reason = `confidence ${mergeResult.confidence.toFixed(2)} < target ${policy.confidence_target.toFixed(2)}; budget remaining $${budgetRemaining.toFixed(2)} < est. escalation cost $${assumedCost.toFixed(2)} — alerting with honest sub-target confidence, no fabrication`;
    logger.info(`Escalation: ${reason}`);
    return { triggered: false, reason };
  }

  const serviceId = params.serviceId ?? env.ESCALATION_AGENT_SERVICE_ID;
  if (!serviceId && !(params.simulate ?? env.CROO_SIMULATE)) {
    const reason = `confidence ${mergeResult.confidence.toFixed(2)} < target ${policy.confidence_target.toFixed(2)}; budget remaining $${budgetRemaining.toFixed(2)}; escalation agent not configured (ESCALATION_AGENT_SERVICE_ID empty) — alerting with honest pre-escalation confidence`;
    logger.info(`Escalation: ${reason}`);
    return { triggered: true, reason };
  }

  logger.info(
    `Escalation: confidence ${mergeResult.confidence.toFixed(2)} < target ${policy.confidence_target.toFixed(2)}; budget remaining $${budgetRemaining.toFixed(2)}; purchasing one opinion from Themis for ~$${assumedCost.toFixed(2)}.`,
  );

  const outcome = await hireEscalation({
    client: params.client,
    correlator: params.correlator,
    packageName: params.packageName,
    healthVerdict: params.healthVerdict,
    trustVerdict: params.trustVerdict,
    trustConcern: params.trustConcern,
    sources: params.sources,
    simulate: params.simulate,
    simulatedRaw: params.simulatedRaw,
    timeouts: params.timeouts,
    serviceId: params.serviceId,
  });

  if (!outcome.ok) {
    const reason = `confidence ${mergeResult.confidence.toFixed(2)} < target ${policy.confidence_target.toFixed(2)}; escalation attempted but failed at ${outcome.stage}: ${outcome.reason} — alerting with honest pre-escalation confidence`;
    logger.error(`Escalation: ${reason}`);
    return { triggered: true, reason, order_id: outcome.orderId };
  }

  const resolved = resolveWithThemis(outcome.verdict.score, mergeResult.confidence);
  const reason = resolved
    ? `confidence ${mergeResult.confidence.toFixed(2)} < target ${policy.confidence_target.toFixed(2)}; budget remaining $${budgetRemaining.toFixed(2)}; purchased one Themis opinion for $${outcome.costUsdc.toFixed(2)} (safety score ${outcome.verdict.score.toFixed(2)}) — resolved toward ${resolved.decision}, confidence now ${resolved.confidence.toFixed(2)}`
    : `confidence ${mergeResult.confidence.toFixed(2)} < target ${policy.confidence_target.toFixed(2)}; purchased one Themis opinion for $${outcome.costUsdc.toFixed(2)} (safety score ${outcome.verdict.score.toFixed(2)}) — too close to call, alerting with honest pre-escalation confidence`;
  logger.info(`Escalation: ${reason}`);

  return {
    triggered: true,
    reason,
    agent: "Themis",
    order_id: outcome.orderId,
    tx: outcome.tx,
    cost_usdc: outcome.costUsdc,
    resolvedDecision: resolved?.decision,
    resolvedConfidence: resolved?.confidence,
    review: outcome.verdict.review,
  };
}
