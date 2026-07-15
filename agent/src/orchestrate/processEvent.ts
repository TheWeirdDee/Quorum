import type { AgentClient } from "@croo-network/sdk";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { getRiskPolicy } from "../config/riskPolicy.js";
import type { OrderEventCorrelator } from "../croo/orderCorrelator.js";
import type { QuorumDecision } from "../decision/schema.js";
import { serializeDecision } from "../decision/serialize.js";
import { resolveGithubRepoUrl } from "../detector/npmToGithub.js";
import { fetchNpmPackument } from "../detector/sources/npmRegistry.js";
import { packageNameFromDependency, type TrustEvent } from "../detector/types.js";
import { riskGate } from "../gate/riskGate.js";
import { notifySlack } from "../notify/slack.js";
import { insertDecision } from "../store/decisions.js";
import type { QuorumDb } from "../store/db.js";
import { insertOrder } from "../store/orders.js";
import type { RepoRecord } from "../store/repos.js";
import { getSeenEventId } from "../store/seenEvents.js";
import { investigate, toDecisionEvent } from "./investigate.js";

export interface ProcessEventParams {
  db: QuorumDb;
  client: AgentClient;
  correlator: OrderEventCorrelator;
  repo: RepoRecord;
  event: TrustEvent;
  simulate?: boolean | undefined;
  simulatedHealthRaw?: unknown;
  simulatedTrustRaw?: unknown;
  simulatedEscalationRaw?: unknown;
  timeouts?: { orderCreatedMs?: number; orderCompletedMs?: number } | undefined;
  deadlineMs?: number | undefined;
}

export type ProcessEventResult = { ok: true; decision: QuorumDecision } | { ok: false; reason: string };

/**
 * Persists a decision (FR-7) and one `orders` row per real CAP order it
 * references (health/trust/escalation, whichever are present). Best-effort:
 * a storage failure is logged, never thrown — the decision was already
 * produced (and possibly already delivered/notified) and must not be lost
 * from the caller's perspective just because the write failed.
 */
export async function persistDecisionAndOrders(db: QuorumDb, event: TrustEvent | undefined, decision: QuorumDecision): Promise<void> {
  try {
    await db.transaction(async (trx) => {
      const eventId = event ? await getSeenEventId(trx, event) : undefined;
      const record = await insertDecision(trx, {
        ...(eventId !== undefined ? { eventId } : {}),
        payload: decision,
        decision: decision.decision,
        confidence: decision.confidence,
        totalSpendUsdc: decision.total_spend_usdc,
        decidedAt: decision.decided_at,
      });

      const legs = [
        decision.lenses.health && { ...decision.lenses.health },
        decision.lenses.trust && { ...decision.lenses.trust },
        decision.escalation.triggered && decision.escalation.order_id
          ? { agent: decision.escalation.agent, order_id: decision.escalation.order_id, tx: decision.escalation.tx, cost_usdc: decision.escalation.cost_usdc }
          : undefined,
      ];

      for (const leg of legs) {
        if (!leg?.order_id) continue;
        await insertOrder(trx, {
          direction: "outbound",
          orderId: leg.order_id,
          decisionId: record.id,
          status: "completed",
          ...(leg.agent !== undefined ? { counterparty: leg.agent } : {}),
          ...(leg.cost_usdc !== undefined ? { costUsdc: leg.cost_usdc } : {}),
          ...(leg.tx !== undefined ? { tx: leg.tx } : {}),
        });
      }
    });
  } catch (err) {
    logger.error("persistDecisionAndOrders: storage failed (decision itself was already produced):", err);
  }
}

/**
 * Turns one admitted TrustEvent into a persisted, notified quorum.decision.v1
 * — the steady-state loop body (SPEC §2): Risk Gate -> (archive, or hire +
 * merge + escalate via investigate()) -> persist -> Slack. Shared by the
 * poll loop (src/worker/pollLoop.ts) and the provider's baseline scan
 * (src/provider/registerRepo.ts) so both feed one decision-production path.
 *
 * Runs riskGate() itself first (investigate() also runs it internally on
 * the investigated branch) so the network cost of resolving the
 * dependency's own GitHub repo — needed only when there IS something to
 * investigate — isn't paid for the common case (most events archive at $0).
 */
export async function processEvent(params: ProcessEventParams): Promise<ProcessEventResult> {
  const { db, repo, event } = params;
  const policy = getRiskPolicy(repo.risk_policy, { budgetCapUsdc: repo.budget_cap_usdc });
  const gateResult = riskGate(event, policy);

  if (!gateResult.investigated) {
    const decision = serializeDecision({
      investigated: false,
      dependency: event.dependency,
      event: toDecisionEvent(event),
      gateReason: gateResult.reason,
    });
    await persistDecisionAndOrders(db, event, decision);
    if (repo.notify_type !== "none") await notifySlack(decision, repo.notify_webhook ?? undefined);
    return { ok: true, decision };
  }

  const packageName = packageNameFromDependency(event.dependency);
  const repoUrl = await resolveGithubRepoUrl(packageName);
  if (!repoUrl) {
    return {
      ok: false,
      reason: `${event.dependency}: Risk Gate says investigate, but "${packageName}" has no resolvable GitHub repository (required for the health/trust lenses)`,
    };
  }
  const npmHomepage = (await fetchNpmPackument(packageName).catch(() => undefined))?.homepage;

  const result = await investigate({
    event,
    policy,
    client: params.client,
    correlator: params.correlator,
    repoUrl,
    packageName,
    npmHomepage,
    simulate: params.simulate,
    simulatedHealthRaw: params.simulatedHealthRaw,
    simulatedTrustRaw: params.simulatedTrustRaw,
    simulatedEscalationRaw: params.simulatedEscalationRaw,
    escalationServiceId: env.ESCALATION_AGENT_SERVICE_ID || undefined,
    timeouts: params.timeouts,
    deadlineMs: params.deadlineMs,
  });

  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  await persistDecisionAndOrders(db, event, result.decision);
  if (repo.notify_type !== "none") await notifySlack(result.decision, repo.notify_webhook ?? undefined);
  return { ok: true, decision: result.decision };
}
