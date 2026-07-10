import { z } from "zod";
import { severityHintSchema, trustEventSourceSchema, trustEventTypeSchema } from "../detector/types.js";
import { healthVerdictSchema, trustVerdictSchema } from "../merge/types.js";

/**
 * Zod mirror of schemas/quorum.decision.schema.json (kept hand-in-hand with
 * it — see that file for the JSON Schema source of truth used at the
 * provider boundary in later milestones).
 */
export const lensResultSchema = z
  .object({
    agent: z.string().min(1),
    verdict: z.union([healthVerdictSchema, trustVerdictSchema]),
    order_id: z.string().optional(),
    tx: z.string().optional(),
    cost_usdc: z.number().min(0).optional(),
  })
  .strict();
export type LensResult = z.infer<typeof lensResultSchema>;

export const decisionEventSchema = z
  .object({
    type: trustEventTypeSchema,
    detail: z.string(),
    source: trustEventSourceSchema,
    ref: z.string().min(1),
    severity_hint: severityHintSchema,
  })
  .strict();
export type DecisionEvent = z.infer<typeof decisionEventSchema>;

export const gateBlockSchema = z
  .object({
    investigated: z.boolean(),
    reason: z.string(),
  })
  .strict();

export const decisionValueSchema = z.enum(["SHIP", "REVIEW", "DO_NOT_SHIP", "ARCHIVED_NO_ACTION"]);

export const escalationBlockSchema = z
  .object({
    triggered: z.boolean(),
    agent: z.string().optional(),
    order_id: z.string().optional(),
    tx: z.string().optional(),
    cost_usdc: z.number().min(0).optional(),
    reason: z.string().optional(),
  })
  .strict();
export type EscalationBlock = z.infer<typeof escalationBlockSchema>;

export const quorumDecisionSchema = z
  .object({
    schema: z.literal("quorum.decision.v1"),
    dependency: z.string().min(1),
    event: decisionEventSchema,
    gate: gateBlockSchema,
    decision: decisionValueSchema,
    confidence: z.number().min(0).max(1),
    lenses: z
      .object({
        health: lensResultSchema.optional(),
        trust: lensResultSchema.optional(),
      })
      .strict(),
    escalation: escalationBlockSchema,
    disagreement: z.string(),
    total_spend_usdc: z.number().min(0),
    receipts: z.array(z.string()),
    decided_at: z.string().datetime(),
  })
  .strict();

export type QuorumDecision = z.infer<typeof quorumDecisionSchema>;
