import type { RiskPolicy } from "../config/riskPolicy.js";
import type { HealthVerdict, MergeDecision, MergeResult, TrustVerdict } from "./types.js";

interface MatrixCell {
  decision: MergeDecision;
  confidence: number;
  /** SPEC §6 flags exactly one cell (healthy × high_risk) as the classic disagreement. */
  isDisagreement: boolean;
}

/** Health×trust merge matrix, SPEC §6. Tune here only — nowhere else computes a decision. */
const MERGE_MATRIX: Record<HealthVerdict, Record<TrustVerdict, MatrixCell>> = {
  healthy: {
    trusted: { decision: "SHIP", confidence: 0.95, isDisagreement: false },
    caution: { decision: "REVIEW", confidence: 0.75, isDisagreement: false },
    high_risk: { decision: "REVIEW", confidence: 0.6, isDisagreement: true },
  },
  mixed: {
    trusted: { decision: "REVIEW", confidence: 0.75, isDisagreement: false },
    caution: { decision: "REVIEW", confidence: 0.65, isDisagreement: false },
    high_risk: { decision: "DO_NOT_SHIP", confidence: 0.85, isDisagreement: false },
  },
  unhealthy: {
    trusted: { decision: "REVIEW", confidence: 0.7, isDisagreement: false },
    caution: { decision: "DO_NOT_SHIP", confidence: 0.85, isDisagreement: false },
    high_risk: { decision: "DO_NOT_SHIP", confidence: 0.97, isDisagreement: false },
  },
};

export interface LensSignals {
  healthSignals?: readonly string[] | undefined;
  trustSignals?: readonly string[] | undefined;
}

function describeLens(label: string, verdict: string, signals: readonly string[] | undefined): string {
  if (signals && signals.length > 0) {
    return `${label} sees ${signals.join(", ")} (${verdict})`;
  }
  return `${label} rates it ${verdict}`;
}

/**
 * Reconciles the health lens (Repo Doctor) and trust lens (VERIS) into a
 * decision + confidence (SPEC §6, FR-12). Pure function: does not buy,
 * schedule, or record an escalation — it only flags that one is needed.
 *
 * needs_escalation follows FR-14 (SDK_NOTES.md item 25): sub-target
 * confidence is reason enough to buy a third opinion — NOT only the
 * healthy×high_risk disagreement cell, as M2's narrower first cut had it.
 * merge() is only ever called with both lens verdicts in hand, so "a third
 * opinion could resolve the uncertainty" holds by construction here; the
 * budget-allows condition is the escalation engine's check, made against
 * real quotes, not merge()'s.
 */
export function merge(health: HealthVerdict, trust: TrustVerdict, policy: RiskPolicy, signals: LensSignals = {}): MergeResult {
  const cell = MERGE_MATRIX[health][trust];
  const needs_escalation = cell.confidence < policy.confidence_target;

  const disagreement = cell.isDisagreement
    ? `${describeLens("Repo Doctor", health, signals.healthSignals)}; ${describeLens("VERIS", trust, signals.trustSignals)}.`
    : "";

  const escalation_reason = needs_escalation
    ? `${cell.isDisagreement ? "health/trust disagreement; " : ""}confidence ${cell.confidence.toFixed(2)} < policy target ${policy.confidence_target.toFixed(2)}`
    : "";

  return {
    decision: cell.decision,
    confidence: cell.confidence,
    disagreement,
    needs_escalation,
    escalation_reason,
  };
}
