import { fetchNpmPackument, type NpmPackument } from "./sources/npmRegistry.js";

/**
 * Normalizes any of npm's accepted `repository` field shapes into a plain
 * `https://github.com/owner/repo` URL, or undefined if it isn't (resolvable
 * to) a GitHub repo. Pure — no I/O — so it's unit-testable without a network
 * call; the network-touching part is resolveGithubRepoUrl below.
 *
 * Handles: `git+https://...`, `git://...`, `git+ssh://git@github.com/...`,
 * `git@github.com:owner/repo.git` (scp-style), `github:owner/repo` shorthand,
 * bare `owner/repo` shorthand, and already-bare https URLs — each optionally
 * `.git`-suffixed or trailing-slash-suffixed.
 */
export function normalizeToGithubUrl(raw: string): string | undefined {
  let value = raw.trim();
  if (!value) return undefined;

  value = value.replace(/^git\+/, "");

  if (value.startsWith("github:")) {
    value = `https://github.com/${value.slice("github:".length)}`;
  } else if (/^[\w.-]+\/[\w.-]+$/.test(value)) {
    // bare "owner/repo" shorthand
    value = `https://github.com/${value}`;
  } else if (value.startsWith("git@github.com:")) {
    value = `https://github.com/${value.slice("git@github.com:".length)}`;
  } else if (value.startsWith("git://") || value.startsWith("git+ssh://") || value.startsWith("ssh://")) {
    value = value.replace(/^(git:\/\/|git\+ssh:\/\/|ssh:\/\/)(git@)?/, "https://");
  }

  value = value.replace(/\.git$/, "").replace(/\/+$/, "");

  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(value)) return undefined;
  return value;
}

function repositoryUrlOf(packument: NpmPackument): string | undefined {
  const { repository } = packument;
  if (!repository) return undefined;
  return typeof repository === "string" ? repository : repository.url;
}

/**
 * Resolves an npm package to its GitHub repo URL (FR-10): fetches the
 * packument, reads `repository`, normalizes it. Returns undefined if the
 * package has no repository field, or it points somewhere other than
 * GitHub (Repo Doctor needs a GitHub URL specifically).
 */
export async function resolveGithubRepoUrl(packageName: string): Promise<string | undefined> {
  const packument = await fetchNpmPackument(packageName);
  if (!packument) return undefined;

  const raw = repositoryUrlOf(packument);
  if (!raw) return undefined;

  return normalizeToGithubUrl(raw);
}
