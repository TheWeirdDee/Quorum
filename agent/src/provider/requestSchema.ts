import { z } from "zod";
import { RISK_POLICY_NAMES } from "../config/riskPolicy.js";

/**
 * Zod mirror of schemas/quorum.request.schema.json — the buyer's payload in
 * negotiation.requirements for the `quorum.register` service (FR-1).
 * Validated at negotiation time, BEFORE the buyer locks funds (FR-2).
 */
export const quorumRequestSchema = z
  .object({
    repo: z
      .string()
      .url()
      .regex(/^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/, "must be a GitHub repository URL (https://github.com/owner/name)"),
    ecosystems: z.array(z.enum(["npm", "pypi", "docker", "actions"])).default(["npm"]),
    risk_policy: z.enum(RISK_POLICY_NAMES),
    budget_cap_usdc: z.number().min(0).optional(),
    notify: z
      .object({
        type: z.enum(["slack", "none"]),
        webhook: z.string().url().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type QuorumRequest = z.infer<typeof quorumRequestSchema>;

/**
 * Parses the raw negotiation.requirements string (the SDK carries it as a
 * JSON string, SDK_NOTES.md item 2). Returns a structured result rather
 * than throwing, so the caller can pass the human-readable reason straight
 * to rejectNegotiation.
 */
export function parseQuorumRequest(raw: string): { ok: true; request: QuorumRequest } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "requirements is not valid JSON" };
  }

  const result = quorumRequestSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    return { ok: false, reason: `invalid quorum.register request: ${issues}` };
  }
  return { ok: true, request: result.data };
}
