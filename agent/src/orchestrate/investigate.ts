import type { AgentClient } from "@croo-network/sdk";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import type { RiskPolicy } from "../config/riskPolicy.js";
import type { OrderEventCorrelator } from "../croo/orderCorrelator.js";
import type { DecisionEvent, EscalationBlock, LensResult, QuorumDecision } from "../decision/schema.js";
import { serializeDecision } from "../decision/serialize.js";
import type { TrustEvent } from "../detector/types.js";
import { escalate, type EscalationOutcome } from "../escalate/escalate.js";
import { riskGate } from "../gate/riskGate.js";
import { hireRepoDoctor } from "../hire/repoDoctor.js";
import { hireVeris } from "../hire/veris.js";
import { merge } from "../merge/merge.js";
import type { MergeResult } from "../merge/types.js";

export interface InvestigateParams {
  event: TrustEvent;
  policy: RiskPolicy;
  client: AgentClient;
  correlator: OrderEventCorrelator;
  /** The dependency's own GitHub repo URL (resolved upstream by the npm→GitHub resolver). */
  repoUrl: string;
  packageName: string;
  npmHomepage?: string | undefined;
  simulate?: boolean | undefined;
  simulatedHealthRaw?: unknown;
  simulatedTrustRaw?: unknown;
  simulatedEscalationRaw?: unknown;
  escalationServiceId?: string | undefined;
  timeouts?: { orderCreatedMs?: number; orderCompletedMs?: number } | undefined;
  /** Latest time at which autonomous purchasing may continue. */
  deadlineMs?: number | undefined;
}

export type InvestigateResult =
  | {
      ok: true;
      decision: QuorumDecision;
      /**
       * Present only on the investigated path. quorum.decision.v1 (M2's
       * design) deliberately hides needs_escalation/escalation_reason from
       * the deliverable — those are the pre-purchase signal, not part of
       * what's served. Exposed here for callers that need it: this demo
       * harness now, the M4 escalation engine next (same signal, same
       * shape it'll need to decide whether to buy a tiebreaker).
       */
      mergeResult?: MergeResult;
    }
  | {
      ok: false;
      reason: string;
      failedLenses: ("health" | "trust")[];
      /** Whichever lens(es) DID succeed, so a caller can still see + log partial spend even though no decision was produced. */
      partialLenses: { health?: LensResult | undefined; trust?: LensResult | undefined };
    };

function contextDetail(event: TrustEvent): string {
  const detail = event.context?.["detail"];
  return typeof detail === "string" ? detail : "";
}

function timeoutsWithinDeadline(
  timeouts: InvestigateParams["timeouts"],
  deadlineMs: number | undefined,
): InvestigateParams["timeouts"] {
  if (deadlineMs === undefined) return timeouts;
  const remainingMs = deadlineMs - Date.now();
  if (remainingMs <= 0) return undefined;
  const perWaitMs = Math.max(1, Math.floor(remainingMs / 2));
  return {
    orderCreatedMs: Math.min(timeouts?.orderCreatedMs ?? env.CROO_ORDER_CREATED_TIMEOUT_MS, perWaitMs),
    orderCompletedMs: Math.min(timeouts?.orderCompletedMs ?? env.CROO_ORDER_COMPLETED_TIMEOUT_MS, perWaitMs),
  };
}

/** Exported for reuse by the M5 poll loop / baseline scan (src/orchestrate/processEvent.ts), which builds the same archived-decision shape outside investigate() when the Risk Gate itself already ran. */
export function toDecisionEvent(event: TrustEvent): DecisionEvent {
  return {
    type: event.type,
    detail: contextDetail(event),
    source: event.source,
    ref: event.ref,
    severity_hint: event.severity_hint,
  };
}

/** Omits empty/undefined fields entirely (matching M2's `{ triggered: false }` style) rather than passing them as `""`/`undefined`. */
function toEscalationBlock(outcome: EscalationOutcome): EscalationBlock {
  return {
    triggered: outcome.triggered,
    ...(outcome.agent !== undefined ? { agent: outcome.agent } : {}),
    ...(outcome.order_id !== undefined ? { order_id: outcome.order_id } : {}),
    ...(outcome.tx !== undefined ? { tx: outcome.tx } : {}),
    ...(outcome.cost_usdc !== undefined ? { cost_usdc: outcome.cost_usdc } : {}),
    ...(outcome.reason ? { reason: outcome.reason } : {}),
  };
}

/**
 * The M3 orchestrator step (SPEC §2/§6, FR-13): for one investigated event,
 * hires Repo Doctor (health) first and buys VERIS (trust) only after health
 * succeeds with budget and SLA remaining. This avoids orphaned trust spend
 * when the health quote is refused. Both successful lenses then feed the
 * existing M2 merge and optional M4 escalation.
 *
 * Degrades gracefully per FR-13: if either hire fails (timeout, rejection,
 * bad deliverable), this does NOT fabricate a decision — merge() genuinely
 * needs both verdicts. Instead it returns a structured failure carrying
 * whichever lens DID succeed, so a caller can log the partial spend and the
 * reason — never auto-retries or guesses a SHIP/DO_NOT_SHIP it cannot support.
 */
export async function investigate(params: InvestigateParams): Promise<InvestigateResult> {
  const gateResult = riskGate(params.event, params.policy);

  if (!gateResult.investigated) {
    return {
      ok: true,
      decision: serializeDecision({
        investigated: false,
        dependency: params.event.dependency,
        event: toDecisionEvent(params.event),
        gateReason: gateResult.reason,
      }),
    };
  }

  if (params.deadlineMs !== undefined && Date.now() >= params.deadlineMs) {
    return {
      ok: false,
      reason: "registration SLA budget exhausted before the first lens; no agents were hired",
      failedLenses: [],
      partialLenses: {},
    };
  }
  const healthTimeouts = timeoutsWithinDeadline(params.timeouts, params.deadlineMs);

  // Purchase sequentially. If health cannot be obtained, a trust result
  // cannot produce a decision, so buying it would be known-orphaned spend.
  const healthOutcome = await hireRepoDoctor({
    client: params.client,
    correlator: params.correlator,
    repoUrl: params.repoUrl,
    simulate: params.simulate,
    simulatedRaw: params.simulatedHealthRaw,
    timeouts: healthTimeouts,
    maxCostUsdc: params.policy.budget_cap_usdc,
  });

  if (!healthOutcome.ok) {
    const reason = `health (Repo Doctor) failed at ${healthOutcome.stage}: ${healthOutcome.reason}; trust (VERIS) not purchased`;
    logger.error(`investigate(${params.event.dependency}) degraded: ${reason}`);
    return { ok: false, reason, failedLenses: ["health"], partialLenses: {} };
  }

  // Both outcomes are narrowed to HireSuccess here (the branch above returned
  // otherwise) — build the LensResults directly rather than reusing the
  // nullable `health`/`trust` computed earlier for the failure path.
  const healthLens: LensResult = {
    agent: "Repo Doctor",
    verdict: healthOutcome.verdict,
    order_id: healthOutcome.orderId,
    tx: healthOutcome.tx,
    cost_usdc: healthOutcome.costUsdc,
  };

  const budgetRemaining = params.policy.budget_cap_usdc - healthOutcome.costUsdc;
  if (budgetRemaining <= 0) {
    const reason = `trust (VERIS) not purchased: policy budget exhausted after health lens ($${healthOutcome.costUsdc.toFixed(2)} spent of $${params.policy.budget_cap_usdc.toFixed(2)})`;
    logger.error(`investigate(${params.event.dependency}) degraded: ${reason}`);
    return { ok: false, reason, failedLenses: ["trust"], partialLenses: { health: healthLens } };
  }

  if (params.deadlineMs !== undefined && Date.now() >= params.deadlineMs) {
    const reason = "trust (VERIS) not purchased: registration SLA budget exhausted after health lens";
    logger.error(`investigate(${params.event.dependency}) degraded: ${reason}`);
    return { ok: false, reason, failedLenses: ["trust"], partialLenses: { health: healthLens } };
  }
  const trustTimeouts = timeoutsWithinDeadline(params.timeouts, params.deadlineMs);

  const trustOutcome = await hireVeris({
    client: params.client,
    correlator: params.correlator,
    packageName: params.packageName,
    repoUrl: params.repoUrl,
    npmHomepage: params.npmHomepage,
    simulate: params.simulate,
    simulatedRaw: params.simulatedTrustRaw,
    timeouts: trustTimeouts,
    maxCostUsdc: budgetRemaining,
  });

  if (!trustOutcome.ok) {
    const reason = `trust (VERIS) failed at ${trustOutcome.stage}: ${trustOutcome.reason}`;
    logger.error(`investigate(${params.event.dependency}) degraded: ${reason}`);
    return { ok: false, reason, failedLenses: ["trust"], partialLenses: { health: healthLens } };
  }

  const trustLens: LensResult = {
    agent: "VERIS",
    verdict: trustOutcome.verdict,
    order_id: trustOutcome.orderId,
    tx: trustOutcome.tx,
    cost_usdc: trustOutcome.costUsdc,
  };

  const mergeResult = merge(healthOutcome.verdict, trustOutcome.verdict, params.policy, {
    healthSignals: undefined,
    trustSignals: undefined,
  });

  // M4: consume needs_escalation — never recompute it, merge() already decided.
  const spentSoFar = (healthLens.cost_usdc ?? 0) + (trustLens.cost_usdc ?? 0);
  const escalationTimeouts = timeoutsWithinDeadline(params.timeouts, params.deadlineMs);
  const escalationOutcome: EscalationOutcome =
    params.deadlineMs !== undefined && escalationTimeouts === undefined
      ? {
          triggered: false,
          reason: `confidence ${mergeResult.confidence.toFixed(2)}; escalation skipped because the registration SLA spending window closed`,
        }
      : await escalate({
          mergeResult,
          policy: params.policy,
          spentSoFar,
          client: params.client,
          correlator: params.correlator,
          packageName: params.packageName,
          healthVerdict: healthOutcome.verdict,
          trustVerdict: trustOutcome.verdict,
          trustConcern: contextDetail(params.event),
          sources: [params.event.ref],
          simulate: params.simulate,
          simulatedRaw: params.simulatedEscalationRaw,
          timeouts: escalationTimeouts,
          serviceId: params.escalationServiceId,
        });

  // Themis's review reasoning augments (never replaces) merge()'s own
  // disagreement text, and only when escalation actually resolved something —
  // an unresolved/failed escalation keeps the original pre-escalation text.
  const disagreement =
    escalationOutcome.resolvedDecision && escalationOutcome.review
      ? `${mergeResult.disagreement} Escalation (Themis): ${escalationOutcome.review}`
      : undefined;

  return {
    ok: true,
    decision: serializeDecision({
      investigated: true,
      dependency: params.event.dependency,
      event: toDecisionEvent(params.event),
      gateReason: gateResult.reason,
      merge: mergeResult,
      lenses: { health: healthLens, trust: trustLens },
      escalation: toEscalationBlock(escalationOutcome),
      resolvedDecision: escalationOutcome.resolvedDecision,
      resolvedConfidence: escalationOutcome.resolvedConfidence,
      disagreement,
    }),
    mergeResult,
  };
}
