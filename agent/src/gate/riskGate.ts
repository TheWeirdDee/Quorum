import { logger } from "../config/logger.js";
import type { RiskPolicy } from "../config/riskPolicy.js";
import type { TrustEvent } from "../detector/types.js";

export interface GateResult {
  investigated: boolean;
  reason: string;
}

function isProductionDependency(event: TrustEvent): boolean {
  const flag = event.context?.is_production_dependency;
  return typeof flag === "boolean" ? flag : true;
}

/** osv/github-sourced events carry a formal advisory; a bare npm registry notice does not. */
function hasAdvisory(event: TrustEvent): boolean {
  return event.source !== "npm";
}

function archiveReason(event: TrustEvent): string {
  const prod = isProductionDependency(event) ? "production" : "non-production";
  const advisory = hasAdvisory(event) ? "" : ", no advisory";
  return `${event.severity_hint} severity, ${prod}${advisory} — not worth purchasing analysis`;
}

/**
 * Deterministic spend/don't-spend classifier (SPEC §6.3, FR-8). Runs before any
 * money moves; never itself hires an agent. Rules, in order:
 *  1. Definite investigate: malicious_release; new_cve at critical/high severity;
 *     maintainer_change on a production dependency; repo_archived; a restrictive
 *     license_change.
 *  2. Definite archive: info/low severity (outside rule 1); a deprecation notice.
 *  3. Ambiguous: everything else — deferred to the policy's escalation
 *     aggressiveness (enterprise investigates ambiguous events, startup/balanced
 *     archive them).
 */
export function riskGate(event: TrustEvent, policy: RiskPolicy): GateResult {
  const prod = isProductionDependency(event);

  let result: GateResult;

  if (event.type === "malicious_release") {
    result = {
      investigated: true,
      reason: `${event.severity_hint} severity on a ${prod ? "production" : "non-production"} dependency`,
    };
  } else if (event.type === "new_cve" && (event.severity_hint === "critical" || event.severity_hint === "high")) {
    result = {
      investigated: true,
      reason: `${event.severity_hint}-severity CVE on a ${prod ? "production" : "non-production"} dependency`,
    };
  } else if (event.type === "maintainer_change" && prod) {
    result = { investigated: true, reason: "maintainer change on a production dependency" };
  } else if (event.type === "repo_archived") {
    result = { investigated: true, reason: "dependency's repo has been archived" };
  } else if (event.type === "license_change" && event.context?.restrictive === true) {
    result = { investigated: true, reason: "license changed to a restrictive license" };
  } else if (event.type === "deprecation" || event.severity_hint === "info" || event.severity_hint === "low") {
    result = { investigated: false, reason: archiveReason(event) };
  } else {
    const investigate = policy.escalation_aggressiveness === "on_uncertainty";
    result = {
      investigated: investigate,
      reason: `ambiguous signal (${event.type}, ${event.severity_hint} severity); ${policy.name} policy ${
        investigate ? "investigates" : "does not investigate"
      } ambiguous events`,
    };
  }

  logger.info(
    `Risk Gate: ${event.dependency} [${event.type}] -> ${result.investigated ? "INVESTIGATE" : "ARCHIVE"} (${result.reason})`,
  );
  return result;
}
