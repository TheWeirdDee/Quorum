import { z } from "zod";

export const healthVerdictSchema = z.enum(["healthy", "mixed", "unhealthy"]);
export type HealthVerdict = z.infer<typeof healthVerdictSchema>;

export const trustVerdictSchema = z.enum(["trusted", "caution", "high_risk"]);
export type TrustVerdict = z.infer<typeof trustVerdictSchema>;

export type MergeDecision = "SHIP" | "REVIEW" | "DO_NOT_SHIP";

export interface MergeResult {
  decision: MergeDecision;
  confidence: number;
  /** Plain-English explanation of health/trust disagreement; empty when the lenses agreed. */
  disagreement: string;
  /** FR-14: true whenever confidence is below the policy target (both lenses in hand, so a third opinion could resolve it). */
  needs_escalation: boolean;
  /** Economic reasoning string for display; empty when needs_escalation is false. */
  escalation_reason: string;
}
