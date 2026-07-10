/** Mirrors schemas/quorum.decision.schema.json / agent/src/decision/schema.ts — kept hand-in-hand with those, not imported from the agent package (a separate npm workspace with no build step). */

export type HealthVerdict = "healthy" | "mixed" | "unhealthy";
export type TrustVerdict = "trusted" | "caution" | "high_risk";
export type LensVerdict = HealthVerdict | TrustVerdict;

export interface LensResult {
  agent: string;
  verdict: LensVerdict;
  order_id?: string;
  tx?: string;
  cost_usdc?: number;
}

export type TrustEventType =
  | "malicious_release"
  | "new_cve"
  | "maintainer_change"
  | "repo_archived"
  | "license_change"
  | "abandonment"
  | "suspicious_cadence"
  | "deprecation"
  | "baseline_scan";

export type SeverityHint = "critical" | "high" | "medium" | "low" | "info";
export type TrustEventSource = "osv" | "github" | "npm" | "system";

export interface DecisionEvent {
  type: TrustEventType;
  detail: string;
  source: TrustEventSource;
  ref: string;
  severity_hint: SeverityHint;
}

export type DecisionValue = "SHIP" | "REVIEW" | "DO_NOT_SHIP" | "ARCHIVED_NO_ACTION";

export interface EscalationBlock {
  triggered: boolean;
  agent?: string;
  order_id?: string;
  tx?: string;
  cost_usdc?: number;
  reason?: string;
}

export interface QuorumDecision {
  schema: "quorum.decision.v1";
  dependency: string;
  event: DecisionEvent;
  gate: { investigated: boolean; reason: string };
  decision: DecisionValue;
  confidence: number;
  lenses: { health?: LensResult; trust?: LensResult };
  escalation: EscalationBlock;
  disagreement: string;
  total_spend_usdc: number;
  receipts: string[];
  decided_at: string;
}

export interface DecisionListItem {
  id: number;
  decision: DecisionValue;
  confidence: number;
  total_spend_usdc: number;
  decided_at: string;
  payload: QuorumDecision;
}

export type RiskPolicyName = "startup" | "balanced" | "enterprise";

export interface RepoListItem {
  id: number;
  github_url: string;
  risk_policy: RiskPolicyName;
  budget_cap_usdc: number | null;
  notify_type: string | null;
  created_at: string;
  dependencyCount: number;
}
