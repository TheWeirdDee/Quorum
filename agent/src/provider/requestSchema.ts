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
 * Normalizes the Agent Store order form's wire format into the shape the
 * schema expects, BEFORE validation. CONFIRMED live: the store's form
 * declares each requirement as a scalar field, so a real buyer's order
 * arrived with `notify` as a JSON *string* ('{"type":"none"}'), `ecosystems`
 * as a plain string, and optional fields as "" — and the strict schema
 * rejected two real paid-intent orders in a row for it. Postel's law at the
 * boundary: coerce the knowable form encodings, then validate strictly.
 */
function normalizeWireRequest(parsed: unknown): unknown {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return parsed;
  const obj: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };

  // Form UIs submit optional fields they can't omit as empty strings.
  for (const key of ["ecosystems", "budget_cap_usdc", "notify"]) {
    if (obj[key] === "") delete obj[key];
  }

  // "npm" or "npm,pypi" (string field) -> ["npm", "pypi"]
  if (typeof obj["ecosystems"] === "string") {
    obj["ecosystems"] = (obj["ecosystems"] as string)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // "0.05" (string number field) -> 0.05
  if (typeof obj["budget_cap_usdc"] === "string") {
    const n = Number(obj["budget_cap_usdc"]);
    if (Number.isFinite(n)) obj["budget_cap_usdc"] = n;
  }

  // '{"type":"none"}' (JSON-in-a-string field, as the service listing documents it) -> { type: "none" }
  if (typeof obj["notify"] === "string") {
    try {
      obj["notify"] = JSON.parse(obj["notify"] as string);
    } catch {
      // leave it; the schema will report the real problem in the rejection reason
    }
  }

  return obj;
}

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

  const result = quorumRequestSchema.safeParse(normalizeWireRequest(parsed));
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    return { ok: false, reason: `invalid quorum.register request: ${issues}` };
  }
  return { ok: true, request: result.data };
}
