import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

export interface NpmMaintainer {
  name: string;
  email?: string;
}

export interface NpmVersionInfo {
  deprecated?: string;
}

export interface NpmPackument {
  name: string;
  "dist-tags"?: { latest?: string };
  time?: Record<string, string>;
  maintainers?: NpmMaintainer[];
  versions?: Record<string, NpmVersionInfo>;
  /** npm allows either an object or a bare "owner/repo" / "github:owner/repo" shorthand string. */
  repository?: string | { type?: string; url?: string };
  homepage?: string;
}

/** GETs a package's full packument from the npm registry. Keyless API. */
export async function fetchNpmPackument(packageName: string): Promise<NpmPackument | undefined> {
  const url = `${env.NPM_REGISTRY_URL}/${encodeURIComponent(packageName)}`;
  const res = await fetch(url);

  if (res.status === 404) return undefined;
  if (!res.ok) {
    logger.warn(`npm registry lookup failed for ${packageName}: ${res.status} ${res.statusText}`);
    return undefined;
  }

  return (await res.json()) as NpmPackument;
}
