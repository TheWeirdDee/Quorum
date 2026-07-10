import { env } from "./env.js";

export const RISK_POLICY_NAMES = ["startup", "balanced", "enterprise"] as const;
export type RiskPolicyName = (typeof RISK_POLICY_NAMES)[number];

export type EscalationAggressiveness = "rarely" | "on_disagreement" | "on_uncertainty";

/**
 * SPEC §5: the buyer picks a policy at register time; the policy governs how
 * much certainty the pipeline buys without the buyer micromanaging per-call.
 */
export interface RiskPolicy {
  name: RiskPolicyName;
  confidence_target: number;
  budget_cap_usdc: number;
  /** Reserved for the escalation engine (milestone 4); not consulted by merge() in M2. */
  escalation_aggressiveness: EscalationAggressiveness;
}

export const RISK_POLICIES: Record<RiskPolicyName, RiskPolicy> = {
  startup: {
    name: "startup",
    confidence_target: env.RISK_POLICY_STARTUP_CONFIDENCE_TARGET,
    budget_cap_usdc: env.RISK_POLICY_STARTUP_BUDGET_CAP_USDC,
    escalation_aggressiveness: env.RISK_POLICY_STARTUP_ESCALATION_AGGRESSIVENESS,
  },
  balanced: {
    name: "balanced",
    confidence_target: env.RISK_POLICY_BALANCED_CONFIDENCE_TARGET,
    budget_cap_usdc: env.RISK_POLICY_BALANCED_BUDGET_CAP_USDC,
    escalation_aggressiveness: env.RISK_POLICY_BALANCED_ESCALATION_AGGRESSIVENESS,
  },
  enterprise: {
    name: "enterprise",
    confidence_target: env.RISK_POLICY_ENTERPRISE_CONFIDENCE_TARGET,
    budget_cap_usdc: env.RISK_POLICY_ENTERPRISE_BUDGET_CAP_USDC,
    escalation_aggressiveness: env.RISK_POLICY_ENTERPRISE_ESCALATION_AGGRESSIVENESS,
  },
};

/**
 * `budgetCapUsdc` lets a buyer's own `budget_cap_usdc` (quorum.register
 * request, FR-1) override the named policy's default cap without touching
 * anything else about it — merge()/escalate() only ever read
 * `policy.budget_cap_usdc` off whatever object they're given, so this needs
 * no change on their side. `null`/`undefined` (buyer didn't set one) keeps
 * the policy's own default.
 */
export function getRiskPolicy(name: RiskPolicyName, overrides: { budgetCapUsdc?: number | null } = {}): RiskPolicy {
  const base = RISK_POLICIES[name];
  if (overrides.budgetCapUsdc === undefined || overrides.budgetCapUsdc === null) return base;
  return { ...base, budget_cap_usdc: overrides.budgetCapUsdc };
}
