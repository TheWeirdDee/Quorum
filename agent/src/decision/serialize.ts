import type { MergeDecision, MergeResult } from "../merge/types.js";
import { quorumDecisionSchema, type DecisionEvent, type EscalationBlock, type LensResult, type QuorumDecision } from "./schema.js";

interface ArchivedInput {
  investigated: false;
  dependency: string;
  event: DecisionEvent;
  gateReason: string;
  decidedAt?: string;
}

interface InvestigatedInput {
  investigated: true;
  dependency: string;
  event: DecisionEvent;
  gateReason: string;
  merge: MergeResult;
  lenses: { health: LensResult; trust: LensResult };
  /** Absent = no escalation attempted (M2 behavior). Present = the M4 escalation engine's outcome, whatever it was. */
  escalation?: EscalationBlock | undefined;
  /**
   * Overrides merge.decision/merge.confidence when the escalation actually
   * resolved the disagreement toward a side. Absent = use merge's own
   * values — either M2 (no escalation engine at all) or M4 when escalation
   * was attempted but didn't resolve anything (empty slot, failure,
   * inconclusive, budget exhausted). Never fabricated either way.
   */
  resolvedDecision?: MergeDecision | undefined;
  resolvedConfidence?: number | undefined;
  /** Overrides merge.disagreement — e.g. to append the escalation agent's review reasoning once it's resolved something. Absent = merge's own text (M2 behavior, or M4 when nothing was resolved). */
  disagreement?: string | undefined;
  decidedAt?: string;
}

export type SerializeDecisionInput = ArchivedInput | InvestigatedInput;

function definedCosts(...costs: (number | undefined)[]): number {
  return costs.filter((c): c is number => typeof c === "number").reduce((sum, c) => sum + c, 0);
}

function definedReceipts(...txs: (string | undefined)[]): string[] {
  return txs.filter((tx): tx is string => typeof tx === "string" && tx.length > 0);
}

/**
 * Assembles a quorum.decision.v1 object from already-known pieces (gate
 * result, merge result, lens results) and validates it against the schema
 * (FR-17). Pure assembly: never derives narrative text, never hires an
 * agent, never fabricates a tx or cost. `escalation.triggered` reflects only
 * whether an escalation was actually purchased — in M2 that's always false;
 * `merge.needs_escalation` is the pre-purchase signal the M4 escalation
 * engine consumes, not part of this deliverable.
 */
export function serializeDecision(input: SerializeDecisionInput): QuorumDecision {
  const decided_at = input.decidedAt ?? new Date().toISOString();
  const gate = { investigated: input.investigated, reason: input.gateReason };

  if (!input.investigated) {
    return quorumDecisionSchema.parse({
      schema: "quorum.decision.v1",
      dependency: input.dependency,
      event: input.event,
      gate,
      decision: "ARCHIVED_NO_ACTION",
      confidence: 1,
      lenses: {},
      escalation: { triggered: false },
      disagreement: "",
      total_spend_usdc: 0,
      receipts: [],
      decided_at,
    });
  }

  const { merge, lenses } = input;
  const escalation = input.escalation ?? { triggered: false };

  return quorumDecisionSchema.parse({
    schema: "quorum.decision.v1",
    dependency: input.dependency,
    event: input.event,
    gate,
    decision: input.resolvedDecision ?? merge.decision,
    confidence: input.resolvedConfidence ?? merge.confidence,
    lenses: { health: lenses.health, trust: lenses.trust },
    escalation,
    disagreement: input.disagreement ?? merge.disagreement,
    total_spend_usdc: definedCosts(lenses.health.cost_usdc, lenses.trust.cost_usdc, escalation.cost_usdc),
    receipts: definedReceipts(lenses.health.tx, lenses.trust.tx, escalation.tx),
    decided_at,
  });
}
