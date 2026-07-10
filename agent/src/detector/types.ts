import { z } from "zod";

export const trustEventTypeSchema = z.enum([
  "malicious_release",
  "new_cve",
  "maintainer_change",
  "repo_archived",
  "license_change",
  "abandonment",
  "suspicious_cadence",
  "deprecation",
  /**
   * M5 provider registration only (never emitted by a source adapter): the
   * synthetic "event" a quorum.register baseline scan reports when
   * indexing found no admitted TrustEvent worth a decision. Lets the
   * baseline decision reuse quorumDecisionSchema's required `event` field
   * honestly instead of inventing a fake real event type.
   */
  "baseline_scan",
]);
export type TrustEventType = z.infer<typeof trustEventTypeSchema>;

export const severityHintSchema = z.enum(["critical", "high", "medium", "low", "info"]);
export type SeverityHint = z.infer<typeof severityHintSchema>;

/** "system" pairs only with "baseline_scan" — Quorum's own registration step, not a polled source. */
export const trustEventSourceSchema = z.enum(["osv", "github", "npm", "system"]);
export type TrustEventSource = z.infer<typeof trustEventSourceSchema>;

/**
 * Normalized shape emitted by every source adapter (SPEC §4). `context` carries
 * source-specific extras (e.g. is_production_dependency, detail, repo url) that
 * the Risk Gate and decision serializer consume in later milestones — passed
 * through untyped since its shape varies by source.
 */
export const trustEventSchema = z.object({
  dependency: z.string().min(1),
  type: trustEventTypeSchema,
  severity_hint: severityHintSchema,
  source: trustEventSourceSchema,
  ref: z.string().min(1),
  observed_at: z.string().datetime(),
  context: z.record(z.string(), z.unknown()).optional(),
});
export type TrustEvent = z.infer<typeof trustEventSchema>;

/** Dedupe key per FR-6: an event fires the pipeline once for this triple. */
export function trustEventKey(event: Pick<TrustEvent, "dependency" | "type" | "ref">): string {
  return `${event.dependency}::${event.type}::${event.ref}`;
}

/**
 * Inverse of the `${name}@${version}` dependency key sources build (e.g.
 * detector/index.ts's `detectTrustEvents`). Splits at the LAST `@` so scoped
 * packages (`@scope/name@1.2.3`) resolve correctly — their own leading `@`
 * sits at index 0, never at the split point, since npm version strings never
 * contain `@`.
 */
export function packageNameFromDependency(dependency: string): string {
  const at = dependency.lastIndexOf("@");
  return at > 0 ? dependency.slice(0, at) : dependency;
}
