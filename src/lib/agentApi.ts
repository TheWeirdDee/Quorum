/**
 * When the dashboard is deployed separately from the worker (e.g. Vercel,
 * which shares no filesystem with wherever the worker runs — see
 * DEPLOY.md §3), this proxies to the worker's own read-only HTTP API
 * (agent/src/api/server.ts) instead of reading agent/quorum.db directly.
 * `QUORUM_AGENT_API_URL` unset (the local-dev / co-located-deploy default)
 * means callers should fall back to the direct file read in lib/db.ts.
 */
export function agentApiConfigured(): boolean {
  return Boolean(process.env.QUORUM_AGENT_API_URL);
}

/**
 * QUORUM_AGENT_API_KEY is the documented name, but the agent-side var this
 * has to match is called DASHBOARD_API_KEY (agent/src/config/env.ts) — two
 * different names for one shared secret across two separate deploys is an
 * easy mismatch to hit setting this up by hand. Accept either name here
 * rather than silently sending an empty bearer token if only the
 * agent-side name got copied over.
 */
function resolveAgentApiKey(): string {
  return process.env.QUORUM_AGENT_API_KEY ?? process.env.DASHBOARD_API_KEY ?? "";
}

export async function fetchFromAgent<T>(path: string): Promise<T> {
  const base = process.env.QUORUM_AGENT_API_URL;
  if (!base) throw new Error("QUORUM_AGENT_API_URL is not set");

  const res = await fetch(`${base.replace(/\/+$/, "")}${path}`, {
    headers: { authorization: `Bearer ${resolveAgentApiKey()}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`agent API ${path} returned ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}
