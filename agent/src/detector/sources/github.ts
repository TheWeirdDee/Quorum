import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

export interface GithubRepoMeta {
  archived: boolean;
  license: { spdx_id?: string } | null;
  pushed_at: string;
  default_branch: string;
  owner: { login: string };
}

export interface ResolvedDependency {
  name: string;
  version: string;
  isProduction: boolean;
}

function authHeaders(): Record<string, string> {
  return env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {};
}

/** Parses `https://github.com/owner/name` (optionally `.git`-suffixed) into its parts. */
export function parseGithubUrl(repoUrl: string): { owner: string; repo: string } {
  const match = /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(repoUrl);
  if (!match || !match[1] || !match[2]) {
    throw new Error(`Not a GitHub repo URL: ${repoUrl}`);
  }
  return { owner: match[1], repo: match[2] };
}

/** GETs repo metadata (archived flag, license, last push, default branch, owner). */
export async function fetchRepoMeta(repoUrl: string): Promise<GithubRepoMeta | undefined> {
  const { owner, repo } = parseGithubUrl(repoUrl);
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: { accept: "application/vnd.github+json", ...authHeaders() },
  });

  if (!res.ok) {
    logger.warn(`GitHub repo lookup failed for ${repoUrl}: ${res.status} ${res.statusText}`);
    return undefined;
  }

  return (await res.json()) as GithubRepoMeta;
}

/**
 * Resolves a monitored repo's npm dependencies by reading its package.json
 * (dependencies = production, devDependencies = non-production). Returns
 * undefined if the repo has no package.json at its default branch root.
 */
export async function resolveNpmDependencies(repoUrl: string): Promise<ResolvedDependency[] | undefined> {
  const { owner, repo } = parseGithubUrl(repoUrl);
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/package.json`, {
    headers: { accept: "application/vnd.github+json", ...authHeaders() },
  });

  if (res.status === 404) return undefined;
  if (!res.ok) {
    logger.warn(`GitHub package.json lookup failed for ${repoUrl}: ${res.status} ${res.statusText}`);
    return undefined;
  }

  const body = (await res.json()) as { content?: string; encoding?: string };
  if (!body.content || body.encoding !== "base64") {
    logger.warn(`Unexpected package.json content encoding for ${repoUrl}`);
    return undefined;
  }

  const manifest = JSON.parse(Buffer.from(body.content, "base64").toString("utf-8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const deps: ResolvedDependency[] = [];
  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
    deps.push({ name, version, isProduction: true });
  }
  for (const [name, version] of Object.entries(manifest.devDependencies ?? {})) {
    deps.push({ name, version, isProduction: false });
  }
  return deps;
}
