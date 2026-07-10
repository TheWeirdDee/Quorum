import type { GithubRepoMeta } from "./sources/github.js";
import type { NpmPackument } from "./sources/npmRegistry.js";
import type { OsvVulnerability } from "./sources/osv.js";
import type { SeverityHint, TrustEvent } from "./types.js";

const RESTRICTIVE_LICENSES = new Set([
  "GPL-3.0",
  "GPL-2.0",
  "AGPL-3.0",
  "SSPL-1.0",
  "BUSL-1.1",
  "Commons-Clause",
]);

const ABANDONMENT_THRESHOLD_DAYS = 365;

function mapOsvSeverity(vuln: OsvVulnerability): SeverityHint {
  const raw = vuln.database_specific?.severity?.toUpperCase();
  switch (raw) {
    case "CRITICAL":
      return "critical";
    case "HIGH":
      return "high";
    case "MODERATE":
      return "medium";
    case "LOW":
      return "low";
    default:
      return "medium";
  }
}

function isMaliciousAdvisory(vuln: OsvVulnerability): boolean {
  if (vuln.id.startsWith("MAL-")) return true;
  const haystack = `${vuln.summary ?? ""} ${vuln.details ?? ""}`.toLowerCase();
  return haystack.includes("malicious") || haystack.includes("malware");
}

/** OSV vulnerability -> TrustEvent (new_cve, or malicious_release for the OSV malware feed). */
export function normalizeOsvVulnerability(
  dependency: string,
  vuln: OsvVulnerability,
): TrustEvent {
  const malicious = isMaliciousAdvisory(vuln);
  return {
    dependency,
    type: malicious ? "malicious_release" : "new_cve",
    severity_hint: malicious ? "critical" : mapOsvSeverity(vuln),
    source: "osv",
    ref: vuln.id,
    observed_at: vuln.published ?? vuln.modified ?? new Date().toISOString(),
    context: {
      detail: vuln.summary ?? vuln.details ?? "",
      aliases: vuln.aliases ?? [],
    },
  };
}

/** npm packument -> TrustEvents: deprecation (per latest version) and maintainer_change (vs. a prior snapshot). */
export function normalizeNpmPackument(
  packageName: string,
  packument: NpmPackument,
  previousMaintainers?: readonly string[],
): TrustEvent[] {
  const events: TrustEvent[] = [];
  const latest = packument["dist-tags"]?.latest;
  const latestVersionInfo = latest ? packument.versions?.[latest] : undefined;
  const observedAt = (latest ? packument.time?.[latest] : undefined) ?? new Date().toISOString();

  if (latest && latestVersionInfo?.deprecated) {
    events.push({
      dependency: `${packageName}@${latest}`,
      type: "deprecation",
      severity_hint: "low",
      source: "npm",
      ref: `https://www.npmjs.com/package/${packageName}`,
      observed_at: observedAt,
      context: { detail: latestVersionInfo.deprecated },
    });
  }

  const currentMaintainers = (packument.maintainers ?? []).map((m) => m.name).sort();
  if (previousMaintainers && !sameMembers(currentMaintainers, previousMaintainers)) {
    events.push({
      dependency: latest ? `${packageName}@${latest}` : packageName,
      type: "maintainer_change",
      severity_hint: "medium",
      source: "npm",
      ref: `npm:${packageName}:maintainers:${currentMaintainers.join(",")}`,
      observed_at: new Date().toISOString(),
      context: { previous: previousMaintainers, current: currentMaintainers },
    });
  }

  return events;
}

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedB = [...b].sort();
  return a.every((value, i) => value === sortedB[i]);
}

/** GitHub repo metadata -> TrustEvents: repo_archived, license_change, abandonment. */
export function normalizeGithubRepoMeta(
  dependency: string,
  repoUrl: string,
  meta: GithubRepoMeta,
  previous?: { license?: string },
): TrustEvent[] {
  const events: TrustEvent[] = [];

  if (meta.archived) {
    events.push({
      dependency,
      type: "repo_archived",
      severity_hint: "high",
      source: "github",
      ref: `${repoUrl}#archived`,
      observed_at: new Date().toISOString(),
      context: { repo: repoUrl },
    });
  }

  const currentLicense = meta.license?.spdx_id;
  if (currentLicense && previous?.license && currentLicense !== previous.license) {
    const restrictive = RESTRICTIVE_LICENSES.has(currentLicense);
    events.push({
      dependency,
      type: "license_change",
      severity_hint: restrictive ? "high" : "low",
      source: "github",
      ref: `${repoUrl}#license:${currentLicense}`,
      observed_at: new Date().toISOString(),
      context: { previous_license: previous.license, new_license: currentLicense, restrictive },
    });
  }

  const daysSincePush = (Date.now() - new Date(meta.pushed_at).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSincePush >= ABANDONMENT_THRESHOLD_DAYS) {
    events.push({
      dependency,
      type: "abandonment",
      severity_hint: "medium",
      source: "github",
      ref: `${repoUrl}#abandonment`,
      observed_at: new Date().toISOString(),
      context: { last_push: meta.pushed_at, days_since_push: Math.floor(daysSincePush) },
    });
  }

  return events;
}
