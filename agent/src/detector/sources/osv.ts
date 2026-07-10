import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

export interface OsvVulnerability {
  id: string;
  summary?: string;
  details?: string;
  published?: string;
  modified?: string;
  aliases?: string[];
  database_specific?: { severity?: string; [key: string]: unknown };
  severity?: { type: string; score: string }[];
}

interface OsvQueryResponse {
  vulns?: OsvVulnerability[];
}

/** POSTs a package+version to OSV.dev and returns any known vulnerabilities. Keyless API. */
export async function queryOsv(packageName: string, version: string): Promise<OsvVulnerability[]> {
  const res = await fetch(env.OSV_API_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ package: { name: packageName, ecosystem: "npm" }, version }),
  });

  if (!res.ok) {
    logger.warn(`OSV query failed for ${packageName}@${version}: ${res.status} ${res.statusText}`);
    return [];
  }

  const body = (await res.json()) as OsvQueryResponse;
  return body.vulns ?? [];
}
